import fs from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";

import { js } from "./helpers/create-fixture.js";
import {
  build,
  createEditor,
  createProject,
  expectBuildSucceeded,
  reactRouterConfig,
  rsbuildConfig,
} from "./helpers/rsbuild.js";

// Build-time rendering (SPA-mode `index.html`, prerendering) evaluates the
// freshly built server bundle. These tests pin down properties of that step
// that only show up in real builds:
//  - #135: the build process must exit even when the app's server graph opens
//    a ref'd handle at module scope (the bundle runs in a terminated worker).
//  - #136: with Rspack's persistent cache, a warm build must render against
//    the assets it emitted, not the previous build's.

// Generous: a hung build never exits, so any finite bound distinguishes.
const BUILD_TIMEOUT_MS = 180_000;

// Node backs BroadcastChannel with a ref'd MessagePort, and it has been a
// global since v18, so `typeof BroadcastChannel !== "undefined"` guards pass
// at build time too. A common SPA pattern (cross-tab sign-out sync). Root is
// the only route whose module scope reaches the SPA server bundle.
const withModuleScopeHandle = async (cwd: string) => {
  fs.writeFileSync(
    path.join(cwd, "app/auth-channel.ts"),
    'export const channel = new BroadcastChannel("app-signout");\n',
  );
  await createEditor(cwd)(
    "app/root.tsx",
    (contents) => `import "./auth-channel";\n${contents}`,
  );
};

const indexHtml = (cwd: string) =>
  fs.readFileSync(path.join(cwd, "build/client/index.html"), "utf8");

test.describe("build process with a module-scope handle in the server graph (#135)", () => {
  test("ssr: false exits after generating index.html", async () => {
    const cwd = await createProject({
      "react-router.config.ts": reactRouterConfig({ ssr: false }),
    });
    await withModuleScopeHandle(cwd);
    const stdout = expectBuildSucceeded(
      build({ cwd, timeout: BUILD_TIMEOUT_MS }),
    );
    expect(stdout).toContain("Removed server build");
    expect(indexHtml(cwd)).toContain("<html");
    expect(fs.existsSync(path.join(cwd, "build/server"))).toBe(false);
  });

  test("prerender exits after writing the prerendered pages", async () => {
    const cwd = await createProject({
      "react-router.config.ts": reactRouterConfig({
        ssr: true,
        prerender: ["/"],
      }),
    });
    await withModuleScopeHandle(cwd);
    expectBuildSucceeded(build({ cwd, timeout: BUILD_TIMEOUT_MS }));
    expect(indexHtml(cwd)).toContain("Welcome to React Router");
  });

  test("RSC prerender exits after writing the prerendered pages", async () => {
    const cwd = await createProject(
      {
        "react-router.config.ts": reactRouterConfig({
          ssr: false,
          prerender: ["/"],
        }),
      },
      "rsc-framework",
    );
    await withModuleScopeHandle(cwd);
    expectBuildSucceeded(build({ cwd, timeout: BUILD_TIMEOUT_MS }));
    expect(indexHtml(cwd)).toContain("Welcome to React Router");
  });
});

test.describe("server build worker lifecycle", () => {
  // Two prerendered routes whose root loader runs `loaderBody` per request.
  const lifecycleFiles = (loaderBody: string) => ({
    "app/root.tsx": js`
      import { appendFileSync } from "node:fs";
      import { Links, Meta, Outlet, Scripts } from "react-router";

      export function loader({ request }) {
        const pathname = new URL(request.url).pathname;
        ${loaderBody}
        return null;
      }

      export default function App() {
        return (
          <html lang="en">
            <head><Meta /><Links /></head>
            <body><Outlet /><Scripts /></body>
          </html>
        );
      }
    `,
    "app/routes/other.tsx": js`
      export default function Other() {
        return <h1>Other</h1>;
      }
    `,
  });

  test("aborts the Request the app receives once each render is released", async () => {
    // In-process rendering aborted the request's signal after the handler
    // settled (createBuildRequestEffect); the worker must relay that to the
    // Request it constructs, or request-scoped cleanup never runs.
    const cwd = await createProject({
      "react-router.config.ts": reactRouterConfig({
        ssr: true,
        prerender: ["/", "/other"],
      }),
      ...lifecycleFiles(`
        request.signal.addEventListener("abort", () => {
          appendFileSync("abort-log.txt", pathname + " ");
        });
      `),
    });
    expectBuildSucceeded(build({ cwd, timeout: BUILD_TIMEOUT_MS }));
    const aborted = fs
      .readFileSync(path.join(cwd, "abort-log.txt"), "utf8")
      .trim()
      .split(/\s+/);
    expect(aborted).toContain("/");
    expect(aborted).toContain("/other");
  });

  test("fails deterministically when the app exits the worker mid-build", async () => {
    // The worker-side abort fires once the first response has been consumed;
    // the app exiting there must fail the build with a clear error rather
    // than leave it waiting. (The idle-exit case is covered by the direct
    // worker test in tests/server-build-worker.test.ts.)
    const cwd = await createProject({
      "react-router.config.ts": reactRouterConfig({
        ssr: true,
        prerender: { paths: ["/", "/other"], concurrency: 1 },
      }),
      ...lifecycleFiles(`
        if (pathname === "/") {
          request.signal.addEventListener("abort", () => process.exit(0));
        }
      `),
    });
    const result = build({ cwd, timeout: BUILD_TIMEOUT_MS });
    const stderr = result.stderr.toString("utf8");
    expect(result.signal, `build did not exit\n${stderr}`).toBeNull();
    expect(result.status).not.toBe(0);
    expect(stderr).toContain("Server build worker exited with code 0");
  });
});

test.describe("ssr: false with performance.buildCache (#136)", () => {
  test("a warm build renders index.html against its own assets", async () => {
    const cwd = await createProject({
      "react-router.config.ts": reactRouterConfig({ ssr: false }),
      "rsbuild.config.ts": await rsbuildConfig.basic({ buildCache: true }),
    });
    const referencedScripts = () => {
      const urls = [
        ...indexHtml(cwd).matchAll(/["']\/(static\/js\/[^"']+\.js)["']/g),
      ].map((match) => match[1]);
      expect(urls.length).toBeGreaterThan(0);
      return [...new Set(urls)];
    };
    const missing = (urls: string[]) =>
      urls.filter((url) => !fs.existsSync(path.join(cwd, "build/client", url)));

    // Cold build: fills the persistent cache.
    expectBuildSucceeded(build({ cwd, timeout: BUILD_TIMEOUT_MS }));
    const coldScripts = referencedScripts();
    expect(missing(coldScripts)).toEqual([]);

    // Change the root route so its (and the manifest's) content hash moves.
    await createEditor(cwd)("app/root.tsx", (contents) =>
      contents.replace('<html lang="en">', '<html lang="en" data-edit="1">'),
    );
    fs.rmSync(path.join(cwd, "build"), { recursive: true, force: true });

    // Warm build: the server-manifest module must not be served from cache.
    expectBuildSucceeded(build({ cwd, timeout: BUILD_TIMEOUT_MS }));
    const warmScripts = referencedScripts();
    expect(warmScripts).not.toEqual(coldScripts);
    expect(missing(warmScripts)).toEqual([]);
  });
});
