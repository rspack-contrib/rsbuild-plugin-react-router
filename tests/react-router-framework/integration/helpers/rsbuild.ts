import type { ChildProcess } from "node:child_process";
import { sync as spawnSync, spawn } from "cross-spawn";
import { existsSync, globSync } from "node:fs";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { platform } from "node:os";
import type { Readable } from "node:stream";
import url from "node:url";
import path from "pathe";
import stripIndent from "strip-indent";
import waitOn from "wait-on";
import getPort from "get-port";
import shell from "shelljs";
import dedent from "dedent";
import type { Page } from "@playwright/test";
import { test as base, expect } from "@playwright/test";
import type { Config } from "@react-router/dev/config";
import {
  assertNoViteConfigFiles,
  finalizeFixtureProject,
  prepareFixtureProjectDependencies,
  reactRouterServeBin,
  rsbuildBin,
} from "./rsbuild-adapter.js";
import {
  assertResourceGuardrail,
  getActiveResourceCounts,
  withFrameworkTestRunEnv,
} from "./test-resource-guard.js";
import type { TemplateName } from "./templates.js";

export { rsbuildConfig } from "./rsbuild-config.js";
export type { TemplateName } from "./templates.js";

const __dirname = url.fileURLToPath(new URL(".", import.meta.url));
const root = path.resolve(__dirname, "../..");
const TMP_DIR = path.join(root, ".tmp/integration");

export const reactRouterConfig = (
  // Don't support function configs due to JSON.stringify()
  config: Omit<Partial<Config>, "buildEnd" | "presets" | "serverBundles"> = {},
) => {
  if (
    typeof config.prerender === "function" ||
    (typeof config.prerender === "object" &&
      !Array.isArray(config.prerender) &&
      typeof config.prerender.paths === "function")
  ) {
    throw new Error("reactRouterConfig() does not support prerender functions");
  }

  return dedent`
    import type { Config } from "@react-router/dev/config";

    export default ${JSON.stringify(config, null, 2)} satisfies Config;
  `;
};

export const EXPRESS_SERVER = (args: {
  port: number;
  base?: string;
  customLogic?: string;
  templateName?: TemplateName;
}) => {
  if (args.templateName?.includes("rsc")) {
    return String.raw`
      import { createRequestListener } from "@remix-run/node-fetch-server";
      import express from "express";

      const app = express();
      let devServer;

      ${args?.customLogic || ""}

      if (process.env.NODE_ENV === "production") {
        app.use(${JSON.stringify(args.base || "/")}, express.static("build/client", { index: false }));
        let build = (await import("./build/server/index.js")).default;
        app.all("*", createRequestListener(build.fetch));
      } else {
        // Delegate to devServer.middlewares for RSC documents, assets, and HMR.
        const { createRsbuild, loadConfig } = await import("@rsbuild/core");
        const { content } = await loadConfig();
        const rsbuild = await createRsbuild({ rsbuildConfig: content });
        devServer = await rsbuild.createDevServer();
        app.use(devServer.middlewares);
      }

      const port = ${args.port};
      const server = app.listen(port, () => {
        console.log('http://localhost:' + port);
        devServer?.afterListen();
      });
      devServer?.connectWebSocket({ server });
    `;
  }

  return String.raw`
    import { createRequestHandler } from "@react-router/express";
    import express from "express";

    const app = express();
    let devServer;

    if (process.env.NODE_ENV === "production") {
      app.use(
        "/assets",
        express.static("build/client/assets", { immutable: true, maxAge: "1y" })
      );
      app.use(express.static("build/client", { maxAge: "1h" }));

      ${args?.customLogic || ""}

      app.all(
        "*",
        createRequestHandler({
          build: await import("./build/server/static/js/app.js"),
        })
      );
    } else {
      // Boot the plugin dev server and delegate to its middleware.
      const { createRsbuild, loadConfig } = await import("@rsbuild/core");
      const { content } = await loadConfig();
      const rsbuild = await createRsbuild({ rsbuildConfig: content });
      devServer = await rsbuild.createDevServer();

      ${args?.customLogic || ""}

      app.use(devServer.middlewares);
    }

    const port = ${args.port};
    const server = app.listen(port, () => {
      console.log('http://localhost:' + port);
      devServer?.afterListen();
    });
    devServer?.connectWebSocket({ server });
  `;
};

type FrameworkModeBundlerTemplateName = "rsbuild-template";

export type RscBundlerTemplateName = "rsc-preview";

// Collapsed from the upstream Vite 7/Vite 8 template pair: the Vite major
// version split is meaningless for rsbuild, so suites parameterized over
// these templates run once.
export const bundlerTemplates = [
  { templateName: "rsbuild-template", templateDisplayName: "rsbuild" },
] as const satisfies Array<{
  templateName: FrameworkModeBundlerTemplateName;
  templateDisplayName: string;
}>;

export const rscBundlerTemplates = [
  { templateName: "rsc-preview", templateDisplayName: "RSC (rsbuild)" },
] as const satisfies Array<{
  templateName: RscBundlerTemplateName;
  templateDisplayName: string;
}>;

export async function createProject(
  files: Record<string, string> = {},
  templateName: TemplateName = "rsbuild-template",
) {
  let projectName = `rr-${Math.random().toString(32).slice(2)}`;
  let projectDir = path.join(TMP_DIR, projectName);
  await mkdir(projectDir, { recursive: true });

  // base template
  let templateDir = path.resolve(__dirname, templateName);
  await cp(templateDir, projectDir, {
    errorOnExist: true,
    filter: (source) => path.basename(source) !== "node_modules",
    recursive: true,
  });

  // user-defined files
  await Promise.all(
    Object.entries(assertNoViteConfigFiles(files)).map(
      async ([filename, contents]) => {
        let filepath = path.join(projectDir, filename);
        await mkdir(path.dirname(filepath), { recursive: true });
        await writeFile(filepath, stripIndent(contents));
      },
    ),
  );

  await finalizeFixtureProject({ projectDir, templateName });
  prepareFixtureProjectDependencies(projectDir, templateName);

  return projectDir;
}

// Keep empty stderr assertions stable when FORCE_COLOR is set by CI.
const colorEnv = {
  FORCE_COLOR: undefined,
  NO_COLOR: "1",
} as const;

export const build = ({
  cwd,
  env = {},
  timeout,
}: {
  cwd: string;
  env?: Record<string, string>;
  /** Kill the build (SIGKILL) after this many ms; `status` is then `null`. */
  timeout?: number;
}) => {
  let nodeBin = process.argv[0];
  prepareFixtureProjectDependencies(cwd);

  return spawnSync(nodeBin, [rsbuildBin, "build"], {
    cwd,
    env: withFrameworkTestRunEnv({
      ...process.env,
      ...colorEnv,
      ...env,
    }),
    timeout,
    killSignal: "SIGKILL",
  });
};

const formatBuildFailure = (result: ReturnType<typeof build>) => {
  const stdout = result.stdout?.toString("utf8").trim();
  const stderr = result.stderr?.toString("utf8").trim();
  return [
    `Expected Rsbuild build to exit successfully, got status=${result.status} signal=${result.signal}`,
    stdout ? `stdout:\n${stdout}` : "stdout: <empty>",
    stderr ? `stderr:\n${stderr}` : "stderr: <empty>",
  ].join("\n\n");
};

/** Asserts a successful exit (a killed or hung build has `status: null`) and returns stdout. */
export const expectBuildSucceeded = (result: ReturnType<typeof build>) => {
  expect(result.status, formatBuildFailure(result)).toBe(0);
  return result.stdout.toString("utf8");
};

export const reactRouterServe = async ({
  cwd,
  port,
  serverBundle,
  basename,
  base,
}: {
  cwd: string;
  port: number;
  serverBundle?: string;
  basename?: string;
  base?: string;
}) => {
  let nodeBin = process.argv[0];
  const isRscFixture =
    !serverBundle &&
    existsSync(path.join(cwd, "start.js")) &&
    existsSync(path.join(cwd, "build/server/index.js"));
  const args = isRscFixture
    ? ["start.js"]
    : [
        reactRouterServeBin,
        serverBundle
          ? `build/server/${serverBundle}/index.js`
          : "build/server/static/js/app.js",
      ];
  assertResourceGuardrail();
  let serveProc = spawn(nodeBin, args, {
    cwd,
    stdio: "pipe",
    detached: platform() !== "win32",
    env: withFrameworkTestRunEnv({
      ...process.env,
      ...colorEnv,
      NODE_ENV: "production",
      PORT: port.toFixed(0),
      ...(base === undefined ? {} : { RSBUILD_BASE: base }),
    }),
  });
  await waitForServer(serveProc, { port, basename });
  return () => stopProcess(serveProc);
};

type ServerArgs = {
  cwd: string;
  port: number;
  env?: Record<string, string>;
  basename?: string;
};

export const createDev =
  (nodeArgs: string[]) =>
  async ({
    cwd,
    port,
    env,
    basename,
  }: ServerArgs): Promise<() => Promise<void>> => {
    prepareFixtureProjectDependencies(cwd);
    const args =
      nodeArgs[0] === rsbuildBin && nodeArgs[1] === "dev"
        ? [...nodeArgs, "--port", String(port)]
        : nodeArgs;
    let proc = node(args, {
      cwd,
      env: {
        NODE_ENV: "development",
        ...env,
      },
    });
    await waitForServer(proc, { port, basename });
    return () => stopProcess(proc);
  };

export const dev = createDev([rsbuildBin, "dev", "--host", "localhost"]);
export const customDev = createDev(["./server.mjs"]);

export const rsbuildPreview = async ({
  cwd,
  port,
}: {
  cwd: string;
  port: number;
}) => {
  // SPA-mode (`ssr: false`) builds have no server bundle
  // (`build/server/static/js/app.js`); there is only a static
  // `build/client` directory. `react-router-serve` cannot serve those, so
  // fall back to a static file server with an SPA fallback to `index.html`,
  // mirroring upstream's `ssr: false` preview handling.
  let serverBundlePath = path.join(cwd, "build/server/static/js/app.js");
  let rscServerBundlePath = path.join(cwd, "build/server/index.js");
  let clientIndexPath = path.join(cwd, "build/client/index.html");
  if (
    !existsSync(serverBundlePath) &&
    !existsSync(rscServerBundlePath) &&
    existsSync(clientIndexPath)
  ) {
    return spaStaticPreview({ cwd, port });
  }
  return reactRouterServe({ cwd, port });
};

// Serves a SPA-mode (`ssr: false`) build's `build/client` directory over HTTP,
// falling back to `index.html` for unmatched routes so client-side routing
// resolves on hard navigations/reloads.
const spaStaticPreview = async ({
  cwd,
  port,
}: {
  cwd: string;
  port: number;
}) => {
  let { createServer } = await import("node:http");
  let { readFile: read } = await import("node:fs/promises");
  let clientDir = path.join(cwd, "build/client");

  const contentTypes: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".map": "application/json; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
  };

  const server = createServer(async (req, res) => {
    try {
      let pathname = decodeURIComponent(
        new URL(req.url ?? "/", "http://localhost").pathname,
      );
      let relativePath = pathname.replace(/^\/+/, "");
      let candidate = path.join(clientDir, relativePath);
      // Prevent path traversal outside the client directory.
      if (!candidate.startsWith(clientDir)) {
        res.statusCode = 403;
        res.end("Forbidden");
        return;
      }

      let filePath: string | null = null;
      if (relativePath && existsSync(candidate) && !candidate.endsWith("/")) {
        filePath = candidate;
      } else if (existsSync(path.join(candidate, "index.html"))) {
        filePath = path.join(candidate, "index.html");
      } else if (path.extname(relativePath)) {
        // A missing asset (has a file extension) must 404 rather than fall
        // back to index.html — otherwise the browser receives HTML for a
        // script/style request and never settles the network.
        res.statusCode = 404;
        res.end("Not found");
        return;
      } else {
        // SPA fallback: serve the root document for client-routed paths.
        filePath = path.join(clientDir, "index.html");
      }

      let body = await read(filePath);
      res.statusCode = 200;
      res.setHeader(
        "Content-Type",
        contentTypes[path.extname(filePath)] ?? "application/octet-stream",
      );
      res.end(body);
    } catch (error) {
      res.statusCode = 500;
      res.end(String(error));
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.on("error", reject);
    server.listen(port, "localhost", () => resolve());
  });

  await waitOn({
    resources: [`http://localhost:${port}/`],
    timeout: platform() === "win32" ? 20000 : 10000,
  });

  return () =>
    new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
};

// Used for testing errors thrown on build when we don't want to start and
// wait for the server
export const rsbuildDevCmd = ({ cwd }: { cwd: string }) => {
  let nodeBin = process.argv[0];
  prepareFixtureProjectDependencies(cwd);
  // `rsbuild dev` is a persistent server and never exits on its own
  // on successful startup. The timeout guard keeps an assumed-to-exit spawn
  // from blocking a whole suite run indefinitely.
  return spawnSync(nodeBin, [rsbuildBin, "dev"], {
    cwd,
    env: withFrameworkTestRunEnv({ ...process.env }),
    timeout: 30_000,
    killSignal: "SIGTERM",
  });
};

declare module "@playwright/test" {
  interface Page {
    errors: Error[];
  }
}

export type Files = (args: { port: number }) => Promise<Record<string, string>>;
type Fixtures = {
  page: Page;
  dev: (
    files: Files,
    templateName?: TemplateName,
  ) => Promise<{
    port: number;
    cwd: string;
  }>;
  customDev: (
    files: Files,
    templateName?: TemplateName,
  ) => Promise<{
    port: number;
    cwd: string;
  }>;
  reactRouterServe: (files: Files) => Promise<{
    port: number;
    cwd: string;
  }>;
  rsbuildPreview: (
    files: Files,
    templateName?: TemplateName,
  ) => Promise<{
    port: number;
    cwd: string;
  }>;
};

export const test = base.extend<Fixtures>({
  page: async ({ page }, use) => {
    page.errors = [];
    page.on("pageerror", (error: Error) => page.errors.push(error));
    await use(page);
  },
  // eslint-disable-next-line no-empty-pattern
  dev: async ({}, use) => {
    let stops: Array<() => unknown> = [];
    await use(async (files, template) => {
      let port = await getPort();
      let cwd = await createProject(await files({ port }), template);
      stops.push(await dev({ cwd, port }));
      return { port, cwd };
    });
    for (let stop of stops.reverse()) {
      await stop();
    }
  },
  // eslint-disable-next-line no-empty-pattern
  customDev: async ({}, use) => {
    let stop: (() => unknown) | undefined;
    await use(async (files, template) => {
      let port = await getPort();
      let cwd = await createProject(await files({ port }), template);
      stop = await customDev({ cwd, port });
      return { port, cwd };
    });
    await stop?.();
  },
  // eslint-disable-next-line no-empty-pattern
  reactRouterServe: async ({}, use) => {
    let stop: (() => unknown) | undefined;
    await use(async (files) => {
      let port = await getPort();
      let cwd = await createProject(await files({ port }));
      let result = build({ cwd });
      expectBuildSucceeded(result);
      stop = await reactRouterServe({ cwd, port });
      return { port, cwd };
    });
    await stop?.();
  },
  // eslint-disable-next-line no-empty-pattern
  rsbuildPreview: async ({}, use) => {
    let stop: (() => unknown) | undefined;
    await use(async (files, template) => {
      let port = await getPort();
      let cwd = await createProject(await files({ port }), template);
      let result = build({ cwd });
      expectBuildSucceeded(result);
      stop = await rsbuildPreview({ cwd, port });
      return { port, cwd };
    });
    await stop?.();
  },
});

function node(
  args: string[],
  options: { cwd: string; env?: Record<string, string> },
) {
  let nodeBin = process.argv[0];
  let nodeOptions = [
    process.env.NODE_OPTIONS,
    "--experimental-vm-modules",
    "--experimental-global-webcrypto",
  ]
    .filter(Boolean)
    .join(" ");

  assertResourceGuardrail();
  let proc = spawn(nodeBin, args, {
    cwd: options.cwd,
    env: withFrameworkTestRunEnv({
      ...process.env,
      ...colorEnv,
      NODE_OPTIONS: nodeOptions,
      ...options.env,
    }),
    stdio: "pipe",
    detached: platform() !== "win32",
  });
  assertResourceGuardrail({
    counts: getActiveResourceCounts({
      ownedPids: proc.pid === undefined ? undefined : [proc.pid],
    }),
  });
  return proc;
}

async function stopProcess(proc: ChildProcess) {
  if (proc.exitCode !== null || proc.signalCode !== null) {
    return;
  }

  let forceKill: NodeJS.Timeout | undefined;
  let settle: NodeJS.Timeout | undefined;
  const exited = new Promise<void>((resolve) => {
    const done = () => {
      if (forceKill) clearTimeout(forceKill);
      if (settle) clearTimeout(settle);
      resolve();
    };
    proc.once("exit", done);
    proc.once("close", done);
    settle = setTimeout(done, 6000);
  });
  const kill = (signal: NodeJS.Signals) => {
    if (proc.pid && platform() !== "win32") {
      try {
        process.kill(-proc.pid, signal);
        return;
      } catch {
        // The group may already be gone; fall back to the direct child.
      }
    }
    proc.kill(signal);
  };

  kill("SIGTERM");
  forceKill = setTimeout(() => kill("SIGKILL"), 5000);
  await exited;
}

async function waitForServer(
  proc: ChildProcess & { stdout: Readable; stderr: Readable },
  args: { port: number; host?: string; basename?: string },
) {
  let devStdout = bufferize(proc.stdout);
  let devStderr = bufferize(proc.stderr);

  await waitOn({
    resources: [
      `http://${args.host ?? "localhost"}:${args.port}${
        args.basename ?? "/"
      }`,
    ],
    timeout: 20000,
  }).catch(async (err) => {
    let stdout = devStdout();
    let stderr = devStderr();
    await stopProcess(proc);
    throw new Error(
      [
        err.message,
        "",
        "exit code: " + proc.exitCode,
        "stdout: " + stdout ? `\n${stdout}\n` : "<empty>",
        "stderr: " + stderr ? `\n${stderr}\n` : "<empty>",
      ].join("\n"),
    );
  });
}

function bufferize(stream: Readable): () => string {
  let buffer = "";
  stream.on("data", (data) => (buffer += data.toString()));
  return () => buffer;
}

export function createEditor(projectDir: string) {
  return async function edit(
    file: string,
    transform: (contents: string) => string,
  ) {
    let filepath = path.join(projectDir, file);
    let contents = await readFile(filepath, "utf8");
    await writeFile(filepath, transform(contents), "utf8");

    return async function revert() {
      await writeFile(filepath, contents, "utf8");
    };
  };
}

export function grep(cwd: string, pattern: RegExp): string[] {
  let assetFiles = globSync("**/*.@(js|jsx|ts|tsx)", { cwd }).map((file) =>
    path.resolve(cwd, file),
  );

  let lines = shell
    .grep("-l", pattern, assetFiles)
    .stdout.trim()
    .split("\n")
    .filter((line) => line.length > 0);
  return lines;
}
