import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import getPort from "get-port";
import { test, expect, type Page } from "@playwright/test";

import { js } from "./helpers/create-fixture.js";
import {
  build,
  createProject,
  reactRouterConfig,
  reactRouterServe,
  rsbuildConfig,
} from "./helpers/rsbuild.js";

// https://github.com/rstackjs/rsbuild-plugin-react-router/issues/129
//
// The plugin must not dictate browser JavaScript filenames: Rsbuild's
// production default, `output.filenameHash: false`, a custom string or function
// `output.filename.js`, a query-hash filename, and a `tools.rspack`
// `chunkFilename` override must all (a) be emitted as configured and (b) be
// what the browser manifest points at. A manifest that references an existing
// but *wrong* file passes any "referenced assets exist" check, so identity is
// proven by client-side navigation into a route whose `clientLoader` and lazy
// `import()` have to run from the manifest-resolved module.

type Scheme = {
  name: string;
  /** Extra rsbuild config object body (inside `defineConfig({ ... })`). */
  config: string;
  /** Emitted entry.client file under build/client (posix, no query). */
  entryFile: RegExp;
  /** Emitted routes/page file under build/client (posix, no query). */
  routeFile: RegExp;
  /** Manifest URL for the routes/page module (may include a query). */
  routeModuleUrl: RegExp;
  /** Emitted async chunk (lazy import) under build/client. */
  asyncFile: RegExp;
};

const HASH = "[a-f0-9]{6,}";

const schemes: Scheme[] = [
  {
    name: "Rsbuild production default",
    config: "",
    entryFile: new RegExp(`^static/js/entry\\.client\\.${HASH}\\.js$`),
    routeFile: new RegExp(`^static/js/routes/page\\.${HASH}\\.js$`),
    routeModuleUrl: new RegExp(`^/static/js/routes/page\\.${HASH}\\.js$`),
    asyncFile: new RegExp(`^static/js/async/[^/]+\\.${HASH}\\.js$`),
  },
  {
    name: "output.filenameHash: false",
    config: "output: { filenameHash: false },",
    entryFile: /^static\/js\/entry\.client\.js$/,
    routeFile: /^static\/js\/routes\/page\.js$/,
    routeModuleUrl: /^\/static\/js\/routes\/page\.js$/,
    asyncFile: /^static\/js\/async\/[^/]+\.js$/,
  },
  {
    name: "output.filename.js hash-first string",
    config:
      "environments: { web: { output: { filename: { js: '[contenthash:8]-[name].js' } } } },",
    entryFile: /^static\/js\/[a-f0-9]{8}-entry\.client\.js$/,
    routeFile: /^static\/js\/[a-f0-9]{8}-routes\/page\.js$/,
    routeModuleUrl: /^\/static\/js\/[a-f0-9]{8}-routes\/page\.js$/,
    asyncFile: /^static\/js\/async\/[a-f0-9]{8}-[^/]+\.js$/,
  },
  {
    name: "output.filename.js function",
    config: `environments: { web: { output: { filename: {
      js: (pathData) => "custom/" + String(pathData.chunk?.name ?? "chunk").replace(/\\//g, "__") + ".[contenthash:6].js",
    } } } },`,
    entryFile: /^static\/js\/custom\/entry\.client\.[a-f0-9]{6}\.js$/,
    routeFile: /^static\/js\/custom\/routes__page\.[a-f0-9]{6}\.js$/,
    routeModuleUrl: /^\/static\/js\/custom\/routes__page\.[a-f0-9]{6}\.js$/,
    asyncFile: /^static\/js\/custom\/[^/]+\.[a-f0-9]{6}\.js$/,
  },
  {
    name: "output.filename.js query hash",
    config:
      "environments: { web: { output: { filename: { js: '[name].js?v=[contenthash:8]' } } } },",
    entryFile: /^static\/js\/entry\.client\.js$/,
    routeFile: /^static\/js\/routes\/page\.js$/,
    routeModuleUrl: /^\/static\/js\/routes\/page\.js\?v=[a-f0-9]{8}$/,
    asyncFile: /^static\/js\/async\/[^/]+\.js$/,
  },
  {
    name: "tools.rspack function chunkFilename override",
    config: `environments: { web: { tools: { rspack: (config) => {
      config.output.chunkFilename = "static/js/chunks/[name].[contenthash:8].js";
    } } } },`,
    entryFile: new RegExp(`^static/js/entry\\.client\\.${HASH}\\.js$`),
    routeFile: new RegExp(`^static/js/routes/page\\.${HASH}\\.js$`),
    routeModuleUrl: new RegExp(`^/static/js/routes/page\\.${HASH}\\.js$`),
    asyncFile: /^static\/js\/chunks\/[^/]+\.[a-f0-9]{8}\.js$/,
  },
];

const appFiles = {
  "react-router.config.ts": reactRouterConfig({}),
  "app/routes/_index.tsx": js`
    import { Link } from "react-router";
    export default function Index() {
      return (
        <>
          <h1 data-home>Home</h1>
          <Link to="/page" data-link>Go to page</Link>
        </>
      );
    }
  `,
  "app/lazy.tsx": js`
    export default function Lazy() {
      return <p data-lazy>lazy chunk loaded</p>;
    }
  `,
  "app/routes/page.tsx": js`
    import { lazy, Suspense, useState } from "react";
    const Lazy = lazy(() => import("../lazy"));

    export async function clientLoader() {
      return { source: "clientLoader" };
    }

    export default function Page({ loaderData }) {
      const [count, setCount] = useState(0);
      return (
        <>
          <p data-source>{loaderData.source}</p>
          <button data-inc onClick={() => setCount(count + 1)}>{count}</button>
          {count > 0 ? (
            <Suspense fallback={<p data-lazy-fallback>loading</p>}>
              <Lazy />
            </Suspense>
          ) : null}
        </>
      );
    }
  `,
};

const listClientFiles = (cwd: string) =>
  readdirSync(path.join(cwd, "build/client"), { recursive: true })
    .map(String)
    .map((file) => file.split(path.sep).join("/"));

const readManifest = (cwd: string, files: string[]) => {
  const manifestFile = files.find((file) =>
    /^static\/js\/(?:[^/]+\/)*manifest-[a-f0-9]+\.js$/.test(file),
  );
  expect(manifestFile, "browser manifest asset").toBeDefined();
  const source = readFileSync(
    path.join(cwd, "build/client", manifestFile!),
    "utf8",
  );
  // `window.__reactRouterManifest={...};` serialized with jsesc (single quotes).
  const json = source
    .replace(/^window\.__reactRouterManifest=/, "")
    .replace(/;$/, "");
  return new Function(`return (${json});`)() as {
    entry: { module: string; imports: string[] };
    routes: Record<string, { module: string; imports?: string[] }>;
  };
};

async function exerciseRoute(page: Page, port: number) {
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  const failed: string[] = [];
  page.on("response", (response) => {
    if (response.status() >= 400) failed.push(`${response.status()} ${response.url()}`);
  });

  await page.goto(`http://localhost:${port}/`, { waitUntil: "networkidle" });
  await expect(page.locator("[data-home]")).toBeVisible();

  // Client-side navigation loads routes/page from the manifest `module` URL;
  // the clientLoader only exists in that module.
  await page.locator("[data-link]").click();
  await expect(page.locator("[data-source]")).toHaveText("clientLoader");
  // Hydrated interactivity + async chunk through the browser publicPath.
  await page.locator("[data-inc]").click();
  await expect(page.locator("[data-inc]")).toHaveText("1");
  await expect(page.locator("[data-lazy]")).toHaveText("lazy chunk loaded");

  expect(failed).toEqual([]);
  expect(pageErrors).toEqual([]);
}

for (const scheme of schemes) {
  test.describe(`Browser output filenames: ${scheme.name}`, () => {
    let cwd: string;
    let port: number;
    let stop: () => Promise<void> | void;

    test.beforeAll(async () => {
      port = await getPort();
      cwd = await createProject({
        ...appFiles,
        "rsbuild.config.ts": `
          import { defineConfig } from "@rsbuild/core";
          import { pluginReact } from "@rsbuild/plugin-react";
          import { pluginReactRouter } from "rsbuild-plugin-react-router";

          export default defineConfig({
            plugins: [pluginReact(), pluginReactRouter()],
            ${await rsbuildConfig.server({ port })}
            ${scheme.config}
          });
        `,
      });
      const result = build({ cwd });
      expect(result.stderr.toString()).toBe("");
      expect(result.status).toBe(0);
      stop = await reactRouterServe({ cwd, port });
    });
    test.afterAll(async () => {
      await stop?.();
    });

    test("emits files with the configured scheme and the manifest references them", async () => {
      const files = listClientFiles(cwd);
      expect(files.filter((f) => scheme.entryFile.test(f))).toHaveLength(1);
      expect(files.filter((f) => scheme.routeFile.test(f))).toHaveLength(1);
      expect(files.filter((f) => scheme.asyncFile.test(f)).length).toBeGreaterThan(0);

      const manifest = readManifest(cwd, files);
      expect(manifest.routes["routes/page"].module).toMatch(scheme.routeModuleUrl);
      // The entry module URL must be the emitted entry file (plus any query).
      const entryUrl = manifest.entry.module.split("?")[0].replace(/^\//, "");
      expect(files).toContain(entryUrl);
      expect(manifest.entry.imports).not.toContain(manifest.entry.module);
    });

    test("manifest URLs resolve to the emitted JavaScript", async ({ request }) => {
      const manifest = readManifest(cwd, listClientFiles(cwd));
      for (const url of [
        manifest.entry.module,
        ...manifest.entry.imports,
        manifest.routes["routes/page"].module,
      ]) {
        const response = await request.get(`http://localhost:${port}${url}`);
        expect(response.status(), url).toBe(200);
        expect(response.headers()["content-type"], url).toMatch(/javascript/);
      }
    });

    test("routes hydrate and navigate through the manifest modules", async ({ page }) => {
      await exerciseRoute(page, port);
    });
  });
}
