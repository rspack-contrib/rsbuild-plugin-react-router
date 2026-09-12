import fs from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";

import { js } from "./helpers/create-fixture.js";
import { build, createProject, reactRouterConfig } from "./helpers/rsbuild.js";

// Build-time rendering (SPA-mode `index.html`, prerendering) evaluates the
// freshly built server bundle. These tests pin down two properties of that
// step that only show up in real builds:
//  - #135: the build process must exit even when the app's server graph opens
//    a ref'd handle at module scope (the bundle runs in a terminated worker).
//  - #136: with Rspack's persistent cache, a warm build must render against
//    the assets it emitted, not the previous build's.

// Generous: a hung build never exits, so any finite bound distinguishes.
const BUILD_TIMEOUT_MS = 180_000;

const rsbuildConfigFile = ({
  rsc = false,
  buildCache = false,
}: { rsc?: boolean; buildCache?: boolean } = {}) => {
  const plugin = rsc ? "pluginReactRouterRSC" : "pluginReactRouter";
  return js`
    import { defineConfig } from "@rsbuild/core";
    import { pluginReact } from "@rsbuild/plugin-react";
    import { ${plugin} } from "rsbuild-plugin-react-router";

    export default defineConfig({
      plugins: [pluginReact(), ${plugin}()],
      performance: { buildCache: ${String(buildCache)} },
    });
  `;
};

// Node backs BroadcastChannel with a ref'd MessagePort, and it has been a
// global since v18, so `typeof BroadcastChannel !== "undefined"` guards pass
// at build time too. A common SPA pattern (cross-tab sign-out sync).
const moduleScopeHandleFiles = ({ rsc = false } = {}) => ({
  "app/auth-channel.ts": js`
    export const channel = new BroadcastChannel("app-signout");
  `,
  "app/root.tsx": js`
    import { Links, Meta, Outlet, ScrollRestoration${rsc ? "" : ", Scripts"} } from "react-router";
    import "./auth-channel";

    export default function App() {
      return (
        <html lang="en">
          <head>
            <Meta />
            <Links />
          </head>
          <body>
            <Outlet />
            <ScrollRestoration />
            ${rsc ? "" : "<Scripts />"}
          </body>
        </html>
      );
    }
  `,
  "app/routes/_index.tsx": js`
    export default function Index() {
      return <h1>Home</h1>;
    }
  `,
});

const expectBuildExited = (result: ReturnType<typeof build>) => {
  const stderr = result.stderr.toString("utf8");
  expect(
    result.signal,
    `build did not exit within ${BUILD_TIMEOUT_MS}ms\n${stderr}`,
  ).toBeNull();
  expect(result.status, stderr).toBe(0);
  return result.stdout.toString("utf8");
};

test.describe("build process with a module-scope handle in the server graph (#135)", () => {
  test("ssr: false exits after generating index.html", async () => {
    const cwd = await createProject({
      "react-router.config.ts": reactRouterConfig({ ssr: false }),
      "rsbuild.config.ts": rsbuildConfigFile(),
      ...moduleScopeHandleFiles(),
    });
    const stdout = expectBuildExited(build({ cwd, timeout: BUILD_TIMEOUT_MS }));
    expect(stdout).toContain("Removed server build");
    expect(fs.existsSync(path.join(cwd, "build/client/index.html"))).toBe(true);
    expect(fs.existsSync(path.join(cwd, "build/server"))).toBe(false);
  });

  test("prerender exits after writing the prerendered pages", async () => {
    const cwd = await createProject({
      "react-router.config.ts": reactRouterConfig({
        ssr: true,
        prerender: ["/"],
      }),
      "rsbuild.config.ts": rsbuildConfigFile(),
      ...moduleScopeHandleFiles(),
    });
    expectBuildExited(build({ cwd, timeout: BUILD_TIMEOUT_MS }));
    expect(
      fs.readFileSync(path.join(cwd, "build/client/index.html"), "utf8"),
    ).toContain("<h1>Home</h1>");
  });

  test("RSC prerender exits after writing the prerendered pages", async () => {
    const cwd = await createProject(
      {
        "react-router.config.ts": reactRouterConfig({
          ssr: false,
          prerender: ["/"],
        }),
        "rsbuild.config.ts": rsbuildConfigFile({ rsc: true }),
        ...moduleScopeHandleFiles({ rsc: true }),
      },
      "rsc-framework",
    );
    expectBuildExited(build({ cwd, timeout: BUILD_TIMEOUT_MS }));
    expect(
      fs.readFileSync(path.join(cwd, "build/client/index.html"), "utf8"),
    ).toContain("<h1>Home</h1>");
  });
});

test.describe("ssr: false with performance.buildCache (#136)", () => {
  test("a warm build renders index.html against its own assets", async () => {
    const cwd = await createProject({
      "react-router.config.ts": reactRouterConfig({ ssr: false }),
      "rsbuild.config.ts": rsbuildConfigFile({ buildCache: true }),
      "app/routes/_index.tsx": js`
        export default function Index() {
          return <h1>Home</h1>;
        }
      `,
    });
    const referencedScripts = () => {
      const html = fs.readFileSync(
        path.join(cwd, "build/client/index.html"),
        "utf8",
      );
      const urls = [...html.matchAll(/["']\/(static\/js\/[^"']+\.js)["']/g)].map(
        (match) => match[1],
      );
      expect(urls.length).toBeGreaterThan(0);
      return [...new Set(urls)];
    };
    const emitted = (url: string) =>
      fs.existsSync(path.join(cwd, "build/client", url));

    // Cold build: fills the persistent cache.
    expectBuildExited(build({ cwd, timeout: BUILD_TIMEOUT_MS }));
    const coldScripts = referencedScripts();
    expect(coldScripts.filter((url) => !emitted(url))).toEqual([]);

    // Change the root route so its (and the manifest's) content hash moves.
    const rootPath = path.join(cwd, "app/root.tsx");
    fs.writeFileSync(
      rootPath,
      fs
        .readFileSync(rootPath, "utf8")
        .replace('<html lang="en">', '<html lang="en" data-edit="1">'),
    );
    fs.rmSync(path.join(cwd, "build"), { recursive: true, force: true });

    // Warm build: the server-manifest module must not be served from cache.
    expectBuildExited(build({ cwd, timeout: BUILD_TIMEOUT_MS }));
    const warmScripts = referencedScripts();
    expect(warmScripts).not.toEqual(coldScripts);
    expect(warmScripts.filter((url) => !emitted(url))).toEqual([]);
  });
});
