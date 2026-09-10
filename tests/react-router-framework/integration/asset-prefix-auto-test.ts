import getPort from "get-port";
import { test, expect, type Page } from "@playwright/test";

import { css, js } from "./helpers/create-fixture.js";
import {
  build,
  createProject,
  customDev,
  reactRouterConfig,
} from "./helpers/rsbuild.js";

// https://github.com/rstackjs/rsbuild-plugin-react-router/issues/130
//
// Two different responsibilities share the asset prefix:
//
//   - the server renders the *initial* asset URLs (scripts, manifest, entry
//     CSS) before any browser runtime exists, so it needs an absolute prefix;
//   - the browser runtime loads *async* JS and CSS. With
//     `environments.web.output.assetPrefix: 'auto'` Rspack derives that base
//     from the executing script's URL instead of a baked-in string.
//
// The plugin used to copy the (normalized) root prefix onto the web compiler's
// `publicPath`, turning `'auto'` into `'/'`. ESM `import()` still resolved
// against the script URL, but CssExtract builds async stylesheet URLs from
// `__webpack_require__.p`, so async CSS was requested from the *page* origin.
//
// These tests serve HTML and assets from different places, make the page
// origin return a real 404 for misplaced asset requests, and assert the async
// stylesheet's request URL and the resulting computed style.

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
  // Production server: the page origin serves the React Router app only. When
  // ASSET_MOUNT is set, the built client is served under that path on the same
  // origin (root subdirectory case); when CDN_PORT is set, a second origin
  // serves it under CDN_MOUNT instead. Either way, `/static/*` on the page
  // origin is unmatched and React Router answers with a real 404.
  "server.mjs": js`
    import { createRequestHandler } from "@react-router/express";
    import express from "express";

    const app = express();
    if (process.env.ASSET_MOUNT) {
      app.use(process.env.ASSET_MOUNT, express.static("build/client", { index: false }));
    }
    app.all("*", createRequestHandler({
      build: await import("./build/server/static/js/app.js"),
    }));
    app.listen(Number(process.env.PORT), () => console.log("app on " + process.env.PORT));

    if (process.env.CDN_PORT) {
      const cdn = express();
      cdn.use((_req, res, next) => {
        res.setHeader("Access-Control-Allow-Origin", "*");
        next();
      });
      cdn.use(process.env.CDN_MOUNT, express.static("build/client", { index: false }));
      cdn.listen(Number(process.env.CDN_PORT), () => console.log("cdn on " + process.env.CDN_PORT));
    }
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

type Case = {
  name: string;
  /** Resolve the root prefix and server env once ports are known. */
  setup: (ports: { port: number; cdnPort: number }) => {
    rootAssetPrefix: string;
    env: Record<string, string>;
    /** Origin + mount every asset request must start with. */
    assetBase: string;
  };
};

const cases: Case[] = [
  {
    name: "assets on a different origin (CDN) under a sub-path",
    setup: ({ cdnPort }) => ({
      rootAssetPrefix: `http://localhost:${cdnPort}/cdn/app/`,
      env: { CDN_PORT: String(cdnPort), CDN_MOUNT: "/cdn/app" },
      assetBase: `http://localhost:${cdnPort}/cdn/app/`,
    }),
  },
  {
    name: "assets on the page origin under a root subdirectory",
    setup: ({ port }) => ({
      rootAssetPrefix: "/app/",
      env: { ASSET_MOUNT: "/app" },
      assetBase: `http://localhost:${port}/app/`,
    }),
  },
];

async function collectAssetRequests(page: Page) {
  const requests: string[] = [];
  const failures: string[] = [];
  page.on("request", (request) => {
    if (/\.(?:m?js|css)(?:\?|$)/.test(request.url())) requests.push(request.url());
  });
  page.on("response", (response) => {
    if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`);
  });
  const errors: Error[] = [];
  page.on("pageerror", (error) => errors.push(error));
  return { requests, failures, errors };
}

for (const testCase of cases) {
  test.describe(`output.assetPrefix 'auto' on web: ${testCase.name}`, () => {
    let port: number;
    let cdnPort: number;
    let assetBase: string;
    let rootAssetPrefix: string;
    let stop: () => Promise<void> | void;

    test.beforeAll(async () => {
      port = await getPort();
      cdnPort = await getPort();
      const resolved = testCase.setup({ port, cdnPort });
      assetBase = resolved.assetBase;
      rootAssetPrefix = resolved.rootAssetPrefix;
      const cwd = await createProject({
        ...appFiles,
        "rsbuild.config.ts": rsbuildConfigFile(resolved.rootAssetPrefix),
      });
      const result = build({ cwd });
      expect(result.stderr.toString()).toBe("");
      expect(result.status).toBe(0);
      stop = await customDev({
        cwd,
        port,
        env: { NODE_ENV: "production", PORT: String(port), ...resolved.env },
      });
    });
    test.afterAll(async () => {
      await stop?.();
    });

    test("the page origin does not serve assets", async ({ request }) => {
      const response = await request.get(
        `http://localhost:${port}/static/js/definitely-missing.js`,
      );
      expect(response.status()).toBe(404);
    });

    test("server-rendered asset URLs use the root prefix", async ({ request }) => {
      const response = await request.get(`http://localhost:${port}/`);
      expect(response.status()).toBe(200);
      const html = await response.text();
      const urls = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css)(?:\?[^"]*)?)"/g)].map(
        (match) => match[1],
      );
      expect(urls.length).toBeGreaterThan(0);
      // Exactly the configured root prefix (absolute CDN URL, or root-relative
      // subdirectory), not the web compiler's 'auto' folded into '/'.
      for (const url of urls) {
        expect(url.startsWith(rootAssetPrefix), `initial asset URL ${url}`).toBe(true);
      }
      // The browser compiler kept 'auto': no `/static/...` root-relative URLs
      // and no baked prefix inside the server-rendered document.
      expect(html).not.toMatch(/(?:src|href)="\/static\//);
    });

    test("async CSS and JS load from the asset origin and apply", async ({ page }) => {
      const { requests, failures, errors } = await collectAssetRequests(page);

      await page.goto(`http://localhost:${port}/`, { waitUntil: "networkidle" });
      await expect(page.locator("[data-home]")).toBeVisible();

      const cssResponse = page.waitForResponse(
        (response) => /\/static\/css\/async\//.test(response.url()),
      );
      await page.locator("[data-load]").click();
      const asyncCss = await cssResponse;

      // The defining #130 failure: async CSS requested from the page origin.
      expect(asyncCss.url().startsWith(`${assetBase}static/css/async/`), asyncCss.url()).toBe(true);
      expect(asyncCss.status()).toBe(200);
      await expect(page.locator("[data-async]")).toHaveCSS("color", ASYNC_CSS_COLOR);

      const asyncJs = requests.filter((url) => /\/static\/js\/async\//.test(url));
      expect(asyncJs.length).toBeGreaterThan(0);
      for (const url of requests) {
        expect(url.startsWith(assetBase), `asset request ${url}`).toBe(true);
      }
      expect(failures).toEqual([]);
      expect(errors).toEqual([]);
    });
  });
}
