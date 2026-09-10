import { readdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import getPort from "get-port";
import { test, expect } from "@playwright/test";

import { css, js } from "./helpers/create-fixture.js";
import {
  build,
  createProject,
  customDev,
  reactRouterConfig,
} from "./helpers/rsbuild.js";
import { rsbuildBin } from "./helpers/rsbuild-adapter.js";
import { observeAssetResponses } from "./helpers/asset-responses.js";

// https://github.com/rstackjs/rsbuild-plugin-react-router/issues/130
//
// Two responsibilities share the asset prefix: the server renders the *initial*
// asset URLs before any browser runtime exists, and the browser runtime loads
// *async* JS and CSS. With `environments.web.output.assetPrefix: 'auto'`
// Rspack derives the runtime base from the executing script's URL. The plugin
// used to copy the normalized root prefix onto the web compiler's `publicPath`,
// so CssExtract requested async stylesheets from the page origin.
//
// Both scenarios serve assets only from a second origin and make the page
// origin return a real 404 for an emitted asset. The relocation scenario is
// the negative control: its build-time root prefix is `/`, so the old
// hard-coded mechanism resolves async CSS to the page origin and fails, while
// automatic resolution follows the script to the asset origin.

const ASYNC_CSS_COLOR = "rgb(255, 0, 0)";

const appFiles = {
  "react-router.config.ts": reactRouterConfig({}),
  "app/components/async-component.css": css`
    .async-component {
      color: ${ASYNC_CSS_COLOR};
    }
  `,
  "app/components/async-component.tsx": js`
    import "./async-component.css";
    export default function AsyncComponent() {
      return <p data-async className="async-component">async css</p>;
    }
  `,
  "app/routes/_index.tsx": js`
    import { lazy, Suspense, useState } from "react";
    const AsyncComponent = lazy(() => import("../components/async-component"));

    export default function Index() {
      const [show, setShow] = useState(false);
      return (
        <>
          <h1 data-home>Home</h1>
          <button data-load onClick={() => setShow(true)}>load</button>
          {show ? (
            <Suspense fallback={<p data-fallback>loading</p>}>
              <AsyncComponent />
            </Suspense>
          ) : null}
        </>
      );
    }
  `,
  // Production server: the page origin serves the React Router app only, so
  // `/static/*` there is unmatched and React Router answers with a real 404.
  // A second origin serves the built client under CDN_MOUNT. With
  // REWRITE_BASE set, the serving boundary rewrites root-relative asset URLs in
  // the server-facing references (the HTML document and the browser manifest)
  // to that base -- the compiled browser runtime is never touched.
  "server.mjs": js`
    import { readFileSync } from "node:fs";
    import { createRequestHandler } from "@react-router/express";
    import express from "express";

    const rewriteBase = process.env.REWRITE_BASE;
    const rewrite = (text, quote) =>
      rewriteBase ? text.replaceAll(quote + "/static/", quote + rewriteBase + "static/") : text;

    const app = express();
    if (rewriteBase) {
      // Buffer HTML responses and rewrite their asset URLs at the boundary.
      app.use((_req, res, next) => {
        const chunks = [];
        const end = res.end.bind(res);
        res.write = (chunk) => (chunks.push(Buffer.from(chunk)), true);
        res.end = (chunk) => {
          if (chunk) chunks.push(Buffer.from(chunk));
          let body = Buffer.concat(chunks).toString("utf8");
          if (String(res.getHeader("content-type")).includes("text/html")) body = rewrite(body, '"');
          res.removeHeader("content-length");
          return end(body);
        };
        next();
      });
    }
    app.all("*", createRequestHandler({
      build: await import("./build/server/static/js/app.js"),
    }));
    app.listen(Number(process.env.PORT), () => console.log("app on " + process.env.PORT));

    const cdn = express();
    cdn.use((_req, res, next) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      next();
    });
    if (rewriteBase) {
      cdn.get(process.env.CDN_MOUNT + "/static/js/manifest-:version.js", (req, res) => {
        res.type("application/javascript");
        res.send(rewrite(readFileSync("build/client" + req.path.slice(process.env.CDN_MOUNT.length), "utf8"), "'"));
      });
    }
    cdn.use(process.env.CDN_MOUNT, express.static("build/client", { index: false }));
    cdn.listen(Number(process.env.CDN_PORT), () => console.log("cdn on " + process.env.CDN_PORT));
  `,
};

const rsbuildConfigFile = (rootAssetPrefix: string) => `
  import { defineConfig } from "@rsbuild/core";
  import { pluginReact } from "@rsbuild/plugin-react";
  import { pluginReactRouter } from "rsbuild-plugin-react-router";

  export default defineConfig({
    plugins: [pluginReact(), pluginReactRouter({ customServer: true })],
    // Server-rendered URLs (manifest, initial scripts/CSS) follow this prefix...
    output: { assetPrefix: ${JSON.stringify(rootAssetPrefix)} },
    // ...while the browser runtime derives its own base from the script URL.
    environments: { web: { output: { assetPrefix: "auto" } } },
  });
`;

type Scenario = {
  name: string;
  /** Root `output.assetPrefix` baked into the build. */
  rootAssetPrefix: (cdnBase: string) => string;
  /** Whether the document's initial URLs are rewritten at the serving boundary. */
  relocate: boolean;
};

const scenarios: Scenario[] = [
  {
    name: "server falls back to the root CDN prefix while the browser stays on 'auto'",
    rootAssetPrefix: (cdnBase) => cdnBase,
    relocate: false,
  },
  {
    name: "relocated runtime: build-time root prefix '/' differs from where assets are served",
    rootAssetPrefix: () => "/",
    relocate: true,
  },
];

const listClientFiles = (cwd: string) =>
  readdirSync(path.join(cwd, "build/client"), { recursive: true })
    .map(String)
    .map((file) => file.split(path.sep).join("/"));

for (const scenario of scenarios) {
  test.describe(`web assetPrefix 'auto': ${scenario.name}`, () => {
    let cwd: string;
    let port: number;
    let cdnPort: number;
    let cdnBase: string;
    let rootAssetPrefix: string;
    let stop: () => Promise<void> | void;

    test.beforeAll(async () => {
      port = await getPort();
      cdnPort = await getPort();
      cdnBase = `http://localhost:${cdnPort}/cdn/app/`;
      rootAssetPrefix = scenario.rootAssetPrefix(cdnBase);
      cwd = await createProject({
        ...appFiles,
        "rsbuild.config.ts": rsbuildConfigFile(rootAssetPrefix),
      });
      const result = build({ cwd });
      expect(result.stderr.toString()).toBe("");
      expect(result.status).toBe(0);
      stop = await customDev({
        cwd,
        port,
        env: {
          NODE_ENV: "production",
          PORT: String(port),
          CDN_PORT: String(cdnPort),
          CDN_MOUNT: "/cdn/app",
          ...(scenario.relocate ? { REWRITE_BASE: cdnBase } : {}),
        },
      });
    });
    test.afterAll(async () => {
      await stop?.();
    });

    test("async CSS and JS resolve from the loaded runtime's origin", async ({ page, request }) => {
      const files = listClientFiles(cwd);
      const emittedCss = files.find((file) => /^static\/css\/async\/.*\.css$/.test(file));
      expect(emittedCss, "an async stylesheet was emitted").toBeDefined();

      await test.step("the final web compiler config keeps publicPath 'auto'", () => {
        const inspect = spawnSync(process.argv[0], [rsbuildBin, "inspect", "--mode", "production"], {
          cwd,
          env: { ...process.env, NODE_ENV: "production" },
        });
        expect(inspect.status, inspect.stderr.toString()).toBe(0);
        const webConfig = readFileSync(
          path.join(cwd, "build/.rsbuild/rspack.config.web.mjs"),
          "utf8",
        );
        // Complementary evidence only; the browser steps below are decisive.
        expect.soft(webConfig).toMatch(/publicPath: 'auto'/);
      });

      await test.step("the page origin cannot serve an emitted asset", async () => {
        const wrongOrigin = await request.get(`http://localhost:${port}/${emittedCss}`);
        expect(wrongOrigin.status()).toBe(404);
        const rightOrigin = await request.get(`${cdnBase}${emittedCss}`);
        expect(rightOrigin.status()).toBe(200);
      });

      const observed = observeAssetResponses(page);
      await page.goto(`http://localhost:${port}/`, { waitUntil: "networkidle" });
      await expect(page.locator("[data-home]")).toBeVisible();

      await test.step("server-rendered initial asset URLs use the root prefix", async () => {
        const initial = await page.evaluate(() =>
          [...document.querySelectorAll("script[src], link[href]")].map(
            (el) => el.getAttribute("src") ?? el.getAttribute("href") ?? "",
          ),
        );
        expect(initial.length).toBeGreaterThan(0);
        for (const url of initial) {
          const expected = scenario.relocate ? cdnBase : rootAssetPrefix;
          expect(url.startsWith(expected), `initial URL ${url}`).toBe(true);
        }
      });

      await test.step("the browser runtime loads async JS and CSS from the asset origin", async () => {
        const cssResponse = page.waitForResponse((response) =>
          /\/static\/css\/async\//.test(response.url()),
        );
        await page.locator("[data-load]").click();
        const asyncCss = await cssResponse;
        // The defining #130 failure: async CSS requested from the page origin.
        expect(asyncCss.url().startsWith(`${cdnBase}static/css/async/`), asyncCss.url()).toBe(true);
        expect(asyncCss.status()).toBe(200);
        await expect(page.locator("[data-async]")).toHaveCSS("color", ASYNC_CSS_COLOR);

        expect(observed.requests.some((url) => /\/static\/js\/async\//.test(url))).toBe(true);
        for (const url of observed.requests) {
          expect(url.startsWith(cdnBase), `asset request ${url}`).toBe(true);
        }
        expect(observed.failures).toEqual([]);
        expect(observed.pageErrors).toEqual([]);
      });
    });
  });
}
