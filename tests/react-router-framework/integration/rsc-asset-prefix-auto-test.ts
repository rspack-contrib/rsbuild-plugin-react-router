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

// RSC framework mode with the browser compiler on `'auto'` and the server's
// initial asset URLs on a root prefix (#130). Everything the server renders
// from the rspack RSC manifest -- bootstrap scripts, route stylesheet links,
// and Flight's client-chunk preload prefix -- must use the server prefix, not
// the `/` rspack records for an automatic browser public path. Assets are only
// reachable at the configured location; the page origin 404s `/static/*`.

const ROUTE_CSS_COLOR = "rgb(0, 128, 0)";
const COUNTER_CSS_COLOR = "rgb(0, 0, 255)";
const ASYNC_CSS_COLOR = "rgb(255, 0, 0)";

const appFiles = {
  "react-router.config.ts": reactRouterConfig({}),
  "app/styles/index.css": css`
    .route-css {
      color: ${ROUTE_CSS_COLOR};
    }
  `,
  "app/components/async-component.css": css`
    .async-component {
      color: ${ASYNC_CSS_COLOR};
    }
  `,
  "app/components/async-component.tsx": js`
    "use client";
    import "./async-component.css";
    export default function AsyncComponent() {
      return <p data-async className="async-component">async css</p>;
    }
  `,
  // The initially rendered client component carries its own stylesheet: its
  // URL comes from the client manifest's `cssFiles`, a third server-emitted
  // reference alongside bootstrap scripts and route `entryCssFiles`.
  "app/components/counter.css": css`
    .counter {
      color: ${COUNTER_CSS_COLOR};
    }
  `,
  "app/components/counter.tsx": js`
    "use client";
    import { lazy, Suspense, useState } from "react";
    import "./counter.css";
    const AsyncComponent = lazy(() => import("./async-component"));

    export function Counter() {
      const [count, setCount] = useState(0);
      return (
        <>
          <button data-inc className="counter" onClick={() => setCount(count + 1)}>{count}</button>
          {count > 0 ? (
            <Suspense fallback={<p data-fallback>loading</p>}>
              <AsyncComponent />
            </Suspense>
          ) : null}
        </>
      );
    }
  `,
  // Server component route with a stylesheet: the route transform streams the
  // manifest's `entryCssFiles` as <link> tags from the server.
  "app/routes/_index.tsx": js`
    import "../styles/index.css";
    import { Counter } from "../components/counter";

    export default function Index() {
      return (
        <>
          <h1 data-home className="route-css">Home</h1>
          <Counter />
        </>
      );
    }
  `,
  "server.mjs": js`
    import { createRequestListener } from "@remix-run/node-fetch-server";
    import express from "express";

    const build = (await import("./build/server/index.js")).default;
    const app = express();
    // Page origin: documents and RSC payloads only. No static assets.
    app.all("*", createRequestListener(build.fetch));
    app.listen(Number(process.env.PORT), () => console.log("app on " + process.env.PORT));

    const cdn = express();
    cdn.use((_req, res, next) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      next();
    });
    cdn.use(process.env.CDN_MOUNT, express.static("build/client", { index: false }));
    cdn.listen(Number(process.env.CDN_PORT), () => console.log("cdn on " + process.env.CDN_PORT));
  `,
};

test.describe("RSC: web assetPrefix 'auto' with assets on a CDN sub-path", () => {
  let port: number;
  let cdnPort: number;
  let assetBase: string;
  let stop: () => Promise<void> | void;

  test.beforeAll(async () => {
    port = await getPort();
    cdnPort = await getPort();
    assetBase = `http://localhost:${cdnPort}/cdn/app/`;
    const cwd = await createProject(
      {
        ...appFiles,
        "rsbuild.config.ts": `
          import { defineConfig } from "@rsbuild/core";
          import { pluginReact } from "@rsbuild/plugin-react";
          import { pluginReactRouterRSC } from "rsbuild-plugin-react-router";

          export default defineConfig({
            plugins: [pluginReact(), pluginReactRouterRSC({ customServer: true })],
            output: { assetPrefix: ${JSON.stringify(assetBase)} },
            environments: { web: { output: { assetPrefix: "auto" } } },
          });
        `,
      },
      "rsc-framework",
    );
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
      },
    });
  });
  test.afterAll(async () => {
    await stop?.();
  });

  test("the page origin does not serve assets", async ({ request }) => {
    const response = await request.get(`http://localhost:${port}/static/js/missing.js`);
    expect(response.status()).toBe(404);
  });

  test("server-rendered bootstrap scripts and route stylesheets use the CDN prefix", async ({
    request,
  }) => {
    const response = await request.get(`http://localhost:${port}/`);
    expect(response.status()).toBe(200);
    const html = await response.text();

    const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]);
    const stylesheets = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(scripts.length).toBeGreaterThan(0);
    expect(stylesheets.length).toBeGreaterThan(0);
    for (const url of [...scripts, ...stylesheets]) {
      expect(url.startsWith(assetBase), `server-rendered URL ${url}`).toBe(true);
    }
    // Rspack records '/' for an automatic public path; none of it may leak.
    expect(html).not.toMatch(/(?:src|href)="\/static\//);
  });

  test("route and client-reference CSS apply before hydration; async CSS loads from the CDN after", async ({
    page,
  }) => {
    // Before hydration: block scripts so only server-rendered markup and
    // stylesheets are in play. Intentional aborts are not HTTP failures, so
    // they are not recorded by the observer used in the second phase.
    await page.route("**/*.js", (route) => route.abort());
    await page.goto(`http://localhost:${port}/`);
    await expect(page.locator("[data-home]")).toHaveCSS("color", ROUTE_CSS_COLOR);
    await expect(page.locator("[data-inc]")).toHaveCSS("color", COUNTER_CSS_COLOR);
    await page.unroute("**/*.js");

    // After hydration: interaction works and the async stylesheet is fetched
    // from the CDN by the browser runtime's automatic public path.
    const observed = observeAssetResponses(page);
    await page.goto(`http://localhost:${port}/`, { waitUntil: "networkidle" });
    await expect(page.locator("[data-home]")).toHaveCSS("color", ROUTE_CSS_COLOR);
    await expect(page.locator("[data-inc]")).toHaveCSS("color", COUNTER_CSS_COLOR);
    const cssResponse = page.waitForResponse((response) =>
      /\/static\/css\/async\//.test(response.url()),
    );
    await page.locator("[data-inc]").click();
    await expect(page.locator("[data-inc]")).toHaveText("1");
    const asyncCss = await cssResponse;
    expect(asyncCss.url().startsWith(`${assetBase}static/css/async/`), asyncCss.url()).toBe(true);
    await expect(page.locator("[data-async]")).toHaveCSS("color", ASYNC_CSS_COLOR);

    for (const url of observed.requests) {
      expect(url.startsWith(assetBase), `asset request ${url}`).toBe(true);
    }
    expect(observed.failures).toEqual([]);
    expect(observed.pageErrors).toEqual([]);
  });
});
