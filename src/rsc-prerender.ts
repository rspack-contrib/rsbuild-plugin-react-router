import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import type { RsbuildPluginAPI } from '@rsbuild/core';
import { dirname, relative, resolve } from 'pathe';
import * as Effect from 'effect/Effect';
import { PLUGIN_NAME, SPA_FALLBACK_HTML_FILE } from './constants.js';
import { startServerBuildWorker } from './server-build-worker-client.js';
import {
  createBuildRequestEffect,
  createBoundedPrerenderTasksEffect,
} from './prerender-build.js';
import { normalizeAssetPrefix } from './plugin-utils.js';
import { getPrerenderConcurrency } from './prerender.js';
import type { Config } from './react-router-config.js';
import { runPluginEffect } from './effect-runtime.js';

/**
 * RSC-mode prerendering.
 *
 * Mirrors React Router's upstream RSC behavior, feeding the shared
 * `prerender` plugin with one request per prerender path (plus
 * `/__spa-fallback.html` when `ssr: false`) and post-processes each HTML
 * response into two artifacts in the client build directory:
 *
 * - `<path>/index.html` — the prerendered document
 * - `<path>.rsc` (`_.rsc` for `/`) — the RSC payload reassembled from the
 *   inline `__FLIGHT_DATA` scripts, served for client-side navigations
 *
 * Instead of an HTTP round-trip through a preview server, the RSC server
 * bundle's default-exported `fetch` handler is invoked in-process, matching
 * how classic mode prerenders through `createRequestHandler`.
 */

export const SPA_FALLBACK_REQUEST_PATH: string = `/${SPA_FALLBACK_HTML_FILE}`;

const redirectStatusCodes = new Set([301, 302, 303, 307, 308]);

const FLIGHT_DATA_SCRIPT_REGEX =
  /<script>\(self\.__FLIGHT_DATA\|\|=\[\]\)\.push\(("(?:[^"\\]|\\.)*")\)<\/script>/gim;

type RscRequestHandler = (request: Request) => Promise<Response>;

type RscPrerenderBuildApi = Pick<RsbuildPluginAPI, 'logger'>;

type RscPrerenderRequest = {
  requestPath: string;
  artifactPath: string;
};

type RunReactRouterRscPrerenderBuildOptions = {
  api: RscPrerenderBuildApi;
  hasWebEnvironment: boolean;
  buildDirectory: string;
  serverBuildFile?: string;
  ssr: boolean;
  prerenderConfig: Config['prerender'];
  prerenderPaths: string[];
  basename: string;
};

// Same empty/'auto'/trailing-slash semantics as asset prefixes.
export const normalizeRscPrerenderBasename: (basename: string) => string =
  normalizeAssetPrefix;

/**
 * The request paths to prerender: the resolved prerender paths joined with
 * the basename, plus the SPA fallback document when `ssr: false`.
 */
export const getRscPrerenderRequests = ({
  prerenderPaths,
  ssr,
  basename,
}: {
  prerenderPaths: string[];
  ssr: boolean;
  basename: string;
}): RscPrerenderRequest[] => {
  const paths = new Set(prerenderPaths);
  if (!ssr) {
    paths.add(SPA_FALLBACK_REQUEST_PATH);
  }
  const normalizedBasename = normalizeRscPrerenderBasename(basename);
  return Array.from(paths).map(path => ({
    artifactPath: path,
    requestPath: `${normalizedBasename}${path.startsWith('/') ? path.slice(1) : path}`,
  }));
};

/**
 * Reassembles the RSC payload from the inline flight data scripts that
 * `react-router`'s HTML stream injects into server-rendered documents.
 * Returns `null` when the document carries no flight data.
 */
export const extractRscFlightData = (html: string): string | null => {
  const matches = Array.from(html.matchAll(FLIGHT_DATA_SCRIPT_REGEX));
  if (matches.length === 0) {
    return null;
  }
  let rscData = '';
  for (const match of matches) {
    rscData += JSON.parse(match[1]) as string;
  }
  return rscData;
};

export const getRscHtmlFilePath = (pathname: string): string => {
  if (pathname === SPA_FALLBACK_REQUEST_PATH) {
    return SPA_FALLBACK_HTML_FILE;
  }
  return `${pathname.endsWith('/') ? pathname : `${pathname}/`}index.html`;
};

export const getRscPayloadFilePath = (pathname: string): string => {
  if (pathname === '/') {
    return '_.rsc';
  }
  if (pathname === SPA_FALLBACK_REQUEST_PATH) {
    return '__spa-fallback.rsc';
  }
  return `${pathname}.rsc`;
};

const createRedirectHtml = ({
  pathname,
  location,
  status,
}: {
  pathname: string;
  location: string;
  status: number;
}): string => {
  // A short delay causes Google to interpret the redirect as temporary.
  const delay = status === 302 ? 2 : 0;
  return `<!doctype html>
<head>
<title>Redirecting to: ${location}</title>
<meta http-equiv="refresh" content="${delay};url=${location}">
<meta name="robots" content="noindex">
</head>
<body>
\t<a href="${location}">
  Redirecting from <code>${pathname}</code> to <code>${location}</code>
</a>
</body>
</html>`;
};

const writePrerenderedFile = async ({
  api,
  clientBuildDir,
  filePath,
  contents,
}: {
  api: RscPrerenderBuildApi;
  clientBuildDir: string;
  filePath: string;
  contents: string | Uint8Array;
}): Promise<void> => {
  const normalizedPath = filePath.startsWith('/')
    ? filePath.slice(1)
    : filePath;
  const outputPath = resolve(clientBuildDir, ...normalizedPath.split('/'));
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, contents);
  api.logger.info(`Prerendered ${relative(process.cwd(), outputPath)}`);
};

const assertPrerenderableResponse = (
  pathname: string,
  response: Response
): void => {
  if (
    response.status === 200 ||
    response.status === 202 ||
    redirectStatusCodes.has(response.status) ||
    (pathname === SPA_FALLBACK_REQUEST_PATH && response.status === 404)
  ) {
    return;
  }
  throw new Error(
    `Prerender: Received a ${response.status} status code from ` +
      `the RSC server while prerendering the \`${pathname}\` path.`
  );
};

const prerenderRscUrlEffect = ({
  api,
  artifactPath,
  clientBuildDir,
  handler,
  url,
}: {
  api: RscPrerenderBuildApi;
  artifactPath?: string;
  clientBuildDir: string;
  handler: RscRequestHandler;
  url: URL;
}): Effect.Effect<void, Error, never> =>
  createBuildRequestEffect(url, undefined, async request => {
    const response = await handler(request);
    const pathname = url.pathname;
    const outputPathname = artifactPath ?? pathname;
    assertPrerenderableResponse(pathname, response);

    if (redirectStatusCodes.has(response.status)) {
      const location = response.headers.get('Location') ?? '';
      await writePrerenderedFile({
        api,
        clientBuildDir,
        filePath: getRscHtmlFilePath(outputPathname),
        contents: createRedirectHtml({
          pathname,
          location,
          status: response.status,
        }),
      });
      return Effect.void;
    }

    const isHtml = Boolean(
      response.headers.get('content-type')?.includes('text/html')
    );

    if (isHtml) {
      const html = await response.text();
      await writePrerenderedFile({
        api,
        clientBuildDir,
        filePath: getRscHtmlFilePath(outputPathname),
        contents: html,
      });
      const flightData = extractRscFlightData(html);
      if (flightData !== null) {
        await writePrerenderedFile({
          api,
          clientBuildDir,
          filePath: getRscPayloadFilePath(outputPathname),
          contents: flightData,
        });
      }
      return Effect.void;
    }

    // Non-HTML response (e.g. a resource route): emit the raw payload at the
    // request path and also prerender its `.rsc` variant for client
    // navigations, matching upstream RSC behavior.
    await writePrerenderedFile({
      api,
      clientBuildDir,
      filePath: outputPathname,
      contents: new Uint8Array(await response.arrayBuffer()),
    });
    if (!pathname.endsWith('.rsc')) {
      const dataUrl = new URL(url);
      dataUrl.pathname += '.rsc';
      return prerenderRscUrlEffect({
        api,
        artifactPath: `${outputPathname}.rsc`,
        clientBuildDir,
        handler,
        url: dataUrl,
      });
    }
    return Effect.void;
  }).pipe(Effect.flatten);

export const runReactRouterRscPrerenderBuild = async (
  options: RunReactRouterRscPrerenderBuildOptions
): Promise<void> => {
  const {
    api,
    hasWebEnvironment,
    buildDirectory,
    serverBuildFile,
    ssr,
    prerenderConfig,
    prerenderPaths,
    basename,
  } = options;

  if (!hasWebEnvironment) {
    return;
  }

  const prerenderRequests = getRscPrerenderRequests({
    prerenderPaths,
    ssr,
    basename,
  });
  if (prerenderRequests.length === 0) {
    return;
  }

  const serverBuildPath = resolve(
    buildDirectory,
    'server',
    serverBuildFile || 'index.js'
  );
  if (!existsSync(serverBuildPath)) {
    api.logger.warn(
      `[${PLUGIN_NAME}] RSC server build not found at ${serverBuildPath}. ` +
        'Skipping prerendering.'
    );
    return;
  }

  const clientBuildDir = resolve(buildDirectory, 'client');
  await mkdir(clientBuildDir, { recursive: true });

  // The server bundle runs in a worker that is terminated afterwards, so a
  // handle its module graph opens cannot keep the build alive (#135).
  const worker = await startServerBuildWorker({ serverBuildPath, mode: 'rsc' });
  try {
    const handler: RscRequestHandler = request => worker.handler(request);

    api.logger.info(`Prerender: ${prerenderRequests.length} path(s)...`);

    await runPluginEffect(
      createBoundedPrerenderTasksEffect(
        prerenderRequests,
        getPrerenderConcurrency(prerenderConfig),
        prerenderRequest =>
          prerenderRscUrlEffect({
            api,
            artifactPath: prerenderRequest.artifactPath,
            clientBuildDir,
            handler,
            url: new URL(`http://localhost${prerenderRequest.requestPath}`),
          })
      )
    );
  } finally {
    await worker.close();
  }
};
