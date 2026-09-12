// Worker entry: evaluates a freshly built server bundle and serves requests to
// it for build-time rendering (SPA-mode `index.html`, prerendering). Running
// the bundle here instead of in the build process means any handle the app's
// server graph creates at module scope (a `BroadcastChannel`, a timer, a
// connection) dies with `worker.terminate()` and cannot keep `rsbuild build`
// alive (#135). The worker sets `IS_RR_BUILD_REQUEST` for its own module
// graph only.
import { parentPort, workerData } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';
import { createRequestHandler } from 'react-router';
import { resolveServerBuildModule } from './server-build-resolution.js';
import type {
  ServerBuildWorkerData,
  ServerBuildWorkerRequest,
  ServerBuildWorkerResponse,
  ServerBuildDescription,
} from './server-build-worker-protocol.js';

type BuildRouteLike = {
  id?: string;
  parentId?: string;
  path?: string;
  index?: boolean;
  caseSensitive?: boolean;
  module?: Record<string, unknown>;
};

const port = parentPort;
if (!port) {
  throw new Error('server-build-worker must run as a worker thread');
}

const { serverBuildPath, mode } = workerData as ServerBuildWorkerData;
process.env.IS_RR_BUILD_REQUEST = 'yes';

const post = (
  message: ServerBuildWorkerResponse,
  transfer: ArrayBuffer[] = []
): void => {
  port.postMessage(message, transfer);
};

const headerEntries = (headers: Headers): [string, string][] => {
  const entries: [string, string][] = [];
  headers.forEach((value, key) => entries.push([key, value]));
  return entries;
};

const serializeError = (error: unknown) => {
  const value = error as { message?: unknown; stack?: unknown; name?: unknown };
  return {
    message: String(value?.message ?? error),
    stack: typeof value?.stack === 'string' ? value.stack : undefined,
    name: typeof value?.name === 'string' ? value.name : undefined,
  };
};

const describeClassicBuild = (build: {
  basename?: string;
  prerender?: string[];
  routes?: Record<string, BuildRouteLike>;
  assets?: { routes?: Record<string, { hasLoader?: boolean }> };
}): ServerBuildDescription => ({
  basename: build.basename,
  prerender: build.prerender,
  routes: Object.fromEntries(
    Object.entries(build.routes ?? {}).map(([id, route]) => [
      id,
      {
        id: route.id,
        parentId: route.parentId,
        path: route.path,
        index: route.index,
        caseSensitive: route.caseSensitive,
        module: {
          default: route.module?.default !== undefined,
          ErrorBoundary: route.module?.ErrorBoundary !== undefined,
          loader: route.module?.loader !== undefined,
        },
      },
    ])
  ),
  assets: {
    routes: Object.fromEntries(
      Object.entries(build.assets?.routes ?? {}).map(([id, route]) => [
        id,
        { hasLoader: route.hasLoader },
      ])
    ),
  },
});

const resolveRscFetch = (
  buildModule: unknown
): ((request: Request) => Promise<Response>) => {
  const moduleRecord = buildModule as
    | { default?: { fetch?: unknown; default?: { fetch?: unknown } } }
    | undefined;
  const fetch =
    typeof moduleRecord?.default?.fetch === 'function'
      ? moduleRecord.default.fetch
      : typeof moduleRecord?.default?.default?.fetch === 'function'
        ? moduleRecord.default.default.fetch
        : null;
  if (!fetch) {
    throw new Error(
      `RSC server build ${JSON.stringify(
        serverBuildPath
      )} must default-export an object with a fetch function.`
    );
  }
  return fetch as (request: Request) => Promise<Response>;
};

const buildModule = await import(pathToFileURL(serverBuildPath).href);
let description: ServerBuildDescription | undefined;
let handler: (request: Request) => Promise<Response>;
if (mode === 'classic') {
  const build = await resolveServerBuildModule(
    buildModule,
    `Server build ${JSON.stringify(serverBuildPath)}`
  );
  description = describeClassicBuild(
    build as unknown as Parameters<typeof describeClassicBuild>[0]
  );
  handler = createRequestHandler(build, 'production');
} else {
  handler = resolveRscFetch(buildModule);
}

port.on('message', async (message: ServerBuildWorkerRequest) => {
  try {
    if (message.type === 'describe') {
      post({ id: message.id, ok: true, description });
      return;
    }
    const response = await handler(
      new Request(message.url, {
        method: message.method,
        headers: message.headers,
        body: message.body as BodyInit | undefined,
      })
    );
    const body = new Uint8Array(await response.arrayBuffer());
    post(
      {
        id: message.id,
        ok: true,
        response: {
          status: response.status,
          statusText: response.statusText,
          headers: headerEntries(response.headers),
          body,
        },
      },
      [body.buffer as ArrayBuffer]
    );
  } catch (error) {
    post({ id: message.id, ok: false, error: serializeError(error) });
  }
});

post({ id: -1, ok: true, ready: true });
