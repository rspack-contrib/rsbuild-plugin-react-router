import getPort from "get-port";
import { test, expect } from "@playwright/test";

import { css, js } from "./helpers/create-fixture.js";
import {
  build,
  createProject,
  customDev,
  reactRouterConfig,
} from "./helpers/rsbuild.js";
import { observeAssetResponses } from "./helpers/asset-responses.js";

// Module Federation with `federation: true`, a minimal host and remote (#132).
//
// Every ModuleFederationPlugin keeps `experiments.asyncStartup: true` (the
// plugin enforces it) and every shared dependency stays non-eager. The remote
// is BUILT with root `output.assetPrefix` pointing at origin A (`/remote/v1/`)
// and the browser compiler on `'auto'`. The host's Node consumer fetches the
// container and an exposed module's server chunk from origin A over HTTP (it
// has no filesystem access to the remote build); the host's browser loads the
// container from origin B under a different sub-path (`/remote/v2/`). Origin A
// refuses async stylesheets, so a browser runtime with the build-time prefix
// baked in (the plugin's old forced `publicPath`) fails the lazy import's CSS,
// whereas automatic resolution follows the loaded runtime to B.
//
// Covered: awaited valid Node ServerBuild through async startup; SSR of the
// remote; browser hydration through async startup (route-module entries are
// made async so their exports resolve); direct ESM container on another
// origin + sub-path; exposed component with a further lazy JS/CSS dependency;
// relocated automatic browser runtime; CORS on the remote's asset responses.
// Not covered: manifest-based (`mf-manifest.json`) remote loading.

const DETAILS_COLOR = "rgb(0, 0, 255)";

const SHARED = `{
  react: { singleton: true },
  "react/": { singleton: true },
  "react-dom": { singleton: true },
  "react-dom/": { singleton: true },
  "react-router": { singleton: true },
  "react-router/": { singleton: true },
}`;

const remoteFiles = (rootAssetPrefix: string) => ({
  "react-router.config.ts": reactRouterConfig({}),
  "rsbuild.config.ts": `
    import { ModuleFederationPlugin } from "@module-federation/enhanced/rspack";
    import { defineConfig } from "@rsbuild/core";
    import { pluginReact } from "@rsbuild/plugin-react";
    import { pluginReactRouter } from "rsbuild-plugin-react-router";

    const common = {
      name: "remote",
      exposes: { "./Widget": "./app/federation/widget.tsx" },
      shareStrategy: "loaded-first",
      experiments: { asyncStartup: true },
      dts: false,
      // Stable container URLs; every other chunk keeps Rsbuild's content hash.
      filename: "static/js/remote.js",
    };

    export default defineConfig({
      plugins: [
        pluginReactRouter({ customServer: true, serverOutput: "commonjs", federation: true }),
        pluginReact({ splitChunks: { react: false, router: false } }),
      ],
      // Server-rendered URLs and the Node federation chunk base.
      output: { assetPrefix: ${JSON.stringify(rootAssetPrefix)} },
      environments: {
        web: {
          // The browser runtime follows the script it was loaded from.
          output: { assetPrefix: "auto" },
          tools: { rspack: { plugins: [new ModuleFederationPlugin({ ...common, shared: ${SHARED}, library: { type: "module" } })] } },
        },
        node: {
          tools: { rspack: { plugins: [new ModuleFederationPlugin({
            ...common,
            shared: ${SHARED},
            library: { type: "commonjs-module" },
            runtimePlugins: ["@module-federation/node/runtimePlugin"],
          })] } },
        },
      },
    });
  `,
  "app/federation/widget-details.css": css`
    .widget-details {
      color: ${DETAILS_COLOR};
    }
  `,
  "app/federation/widget-details.tsx": js`
    import "./widget-details.css";
    export default function WidgetDetails() {
      return <p data-widget-details className="widget-details">remote details</p>;
    }
  `,
  "app/federation/widget.tsx": js`
    import { lazy, Suspense, useState } from "react";
    const Details = lazy(() => import("./widget-details"));
    export default function Widget() {
      const [open, setOpen] = useState(false);
      return (
        <div data-widget>
          <span data-widget-label>remote widget</span>
          <button data-widget-open onClick={() => setOpen(true)}>open</button>
          {open ? <Suspense fallback={<p data-widget-loading>loading</p>}><Details /></Suspense> : null}
        </div>
      );
    }
  `,
  "app/routes/_index.tsx": js`
    export default function Index() {
      return <h1>remote</h1>;
    }
  `,
  // Origin A (SERVER_MOUNT, the build-time root prefix): the client build minus
  // async stylesheets. Origin B (CLIENT_MOUNT): the full client build, where
  // the host actually loads the container from.
  "server.mjs": js`
    import express from "express";

    const cors = (_req, res, next) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      next();
    };

    const a = express();
    a.use(cors);
    a.get("/", (_req, res) => res.end("remote"));
    a.use(process.env.SERVER_MOUNT + "/static/css/async", (_req, res) => res.status(404).end("blocked"));
    a.use(process.env.SERVER_MOUNT, express.static("build/client", { index: false }));
    a.use(process.env.SERVER_MOUNT + "/static/js/async", express.static("build/server/static/js/async"));
    a.listen(Number(process.env.PORT), () => console.log("remote A on " + process.env.PORT));

    const b = express();
    b.use(cors);
    b.use(process.env.CLIENT_MOUNT, express.static("build/client", { index: false }));
    b.listen(Number(process.env.CLIENT_PORT), () => console.log("remote B on " + process.env.CLIENT_PORT));
  `,
});

const hostFiles = (remoteWebEntry: string, remoteNodeEntry: string) => ({
  "react-router.config.ts": reactRouterConfig({}),
  "app/root.tsx": js`
    import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
    export default function App() {
      return (
        <html lang="en"><head><meta charSet="utf-8" /><Meta /><Links /></head>
        <body><Outlet /><ScrollRestoration /><Scripts /></body></html>
      );
    }
  `,
  "rsbuild.config.ts": `
    import { ModuleFederationPlugin } from "@module-federation/enhanced/rspack";
    import { defineConfig } from "@rsbuild/core";
    import { pluginReact } from "@rsbuild/plugin-react";
    import { pluginReactRouter } from "rsbuild-plugin-react-router";

    export default defineConfig({
      plugins: [
        pluginReactRouter({ customServer: true, serverOutput: "commonjs", federation: true }),
        pluginReact({ splitChunks: { react: false, router: false } }),
      ],
      environments: {
        web: {
          tools: { rspack: { plugins: [new ModuleFederationPlugin({
            name: "host",
            shared: ${SHARED},
            shareStrategy: "loaded-first",
            experiments: { asyncStartup: true },
            dts: false,
            remoteType: "import",
            remotes: { remote: ${JSON.stringify(remoteWebEntry)} },
          })] } },
        },
        node: {
          tools: { rspack: { plugins: [new ModuleFederationPlugin({
            name: "host",
            shared: ${SHARED},
            shareStrategy: "loaded-first",
            experiments: { asyncStartup: true },
            dts: false,
            remotes: { remote: ${JSON.stringify(`remote@${remoteNodeEntry}`)} },
            runtimePlugins: ["@module-federation/node/runtimePlugin"],
          })] } },
        },
      },
    });
  `,
  "app/routes/_index.tsx": js`
    import Widget from "remote/Widget";

    export default function Index() {
      return (
        <>
          <h1 data-host>host</h1>
          <Widget />
        </>
      );
    }
  `,
  "server.mjs": js`
    import { createRequestHandler } from "@react-router/express";
    import express from "express";
    import { resolveReactRouterServerBuild } from "rsbuild-plugin-react-router";

    // CommonJS + federation async startup: the server build resolves asynchronously.
    const build = await resolveReactRouterServerBuild(
      await import("./build/server/static/js/app.js"),
    );
    const app = express();
    app.use(express.static("build/client", { index: false }));
    app.all("*", createRequestHandler({ build }));
    app.listen(Number(process.env.PORT), () => console.log("host on " + process.env.PORT));
  `,
});

test.describe("Module Federation: remote consumed by a host on other origins", () => {
  let hostPort: number;
  let remoteAPort: number;
  let remoteBPort: number;
  let remoteABase: string;
  let remoteBBase: string;
  const stops: Array<() => Promise<void> | void> = [];

  test.beforeAll(async () => {
    hostPort = await getPort();
    remoteAPort = await getPort();
    remoteBPort = await getPort();
    remoteABase = `http://localhost:${remoteAPort}/remote/v1/`;
    remoteBBase = `http://localhost:${remoteBPort}/remote/v2/`;

    const remoteCwd = await createProject(remoteFiles(remoteABase));
    const remoteBuild = build({ cwd: remoteCwd });
    expect(remoteBuild.status, remoteBuild.stderr.toString()).toBe(0);
    stops.push(
      await customDev({
        cwd: remoteCwd,
        port: remoteAPort,
        env: {
          NODE_ENV: "production",
          PORT: String(remoteAPort),
          SERVER_MOUNT: "/remote/v1",
          CLIENT_PORT: String(remoteBPort),
          CLIENT_MOUNT: "/remote/v2",
        },
      }),
    );

    // Separate project directory: the host cannot read the remote build.
    const hostCwd = await createProject(
      hostFiles(`${remoteBBase}static/js/remote.js`, `${remoteABase}static/static/js/remote.js`),
    );
    const hostBuild = build({ cwd: hostCwd });
    expect(hostBuild.status, hostBuild.stderr.toString()).toBe(0);
    stops.push(
      await customDev({
        cwd: hostCwd,
        port: hostPort,
        env: { NODE_ENV: "production", PORT: String(hostPort) },
      }),
    );
  });
  test.afterAll(async () => {
    for (const stop of stops.reverse()) await stop();
  });

  test("renders on the server, hydrates, and lazy-loads a remote component across origins", async ({
    page,
    request,
  }) => {
    await test.step("remote asset responses carry CORS for the module graph", async () => {
      for (const url of [`${remoteBBase}static/js/remote.js`, `${remoteBBase}mf-manifest.json`]) {
        const response = await request.get(url);
        expect(response.status(), url).toBe(200);
        expect(response.headers()["access-control-allow-origin"], url).toBe("*");
      }
    });

    await test.step("origin A (the build-time prefix) refuses the remote's async stylesheets", async () => {
      const blocked = await request.get(`${remoteABase}static/css/async/any.css`);
      expect(blocked.status()).toBe(404);
    });

    await test.step("the Node consumer renders the remote over HTTP (isolated filesystem)", async () => {
      const response = await request.get(`http://localhost:${hostPort}/`);
      expect(response.status()).toBe(200);
      const html = await response.text();
      expect(html).toContain("remote widget");
    });

    const observed = observeAssetResponses(page);
    await page.goto(`http://localhost:${hostPort}/`, { waitUntil: "networkidle" });
    await expect(page.locator("[data-widget-label]")).toHaveText("remote widget");

    await test.step("the browser loaded the container from origin B", () => {
      expect(observed.requests).toContain(`${remoteBBase}static/js/remote.js`);
    });

    await test.step("the exposed component's lazy JS and CSS resolve from the loaded runtime (origin B)", async () => {
      const cssResponse = page.waitForResponse((response) =>
        /\/static\/css\/async\//.test(response.url()),
      );
      await page.locator("[data-widget-open]").click();
      const asyncCss = await cssResponse;
      expect(asyncCss.url().startsWith(`${remoteBBase}static/css/async/`), asyncCss.url()).toBe(true);
      expect(asyncCss.status()).toBe(200);
      await expect(page.locator("[data-widget-details]")).toHaveCSS("color", DETAILS_COLOR);

      // Remote-owned assets come from the remote; shared singletons are the
      // host's, so only remote URLs are constrained here.
      const remoteOwned = observed.requests.filter((url) => url.includes("/remote/"));
      expect(remoteOwned.some((url) => /\/static\/js\/async\//.test(url))).toBe(true);
      for (const url of remoteOwned) {
        expect(url.startsWith(remoteBBase), `remote asset ${url}`).toBe(true);
      }
      expect(observed.failures).toEqual([]);
      expect(observed.pageErrors).toEqual([]);
    });
  });
});
