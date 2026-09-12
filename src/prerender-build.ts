import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import fsExtra from 'fs-extra';
import * as Effect from 'effect/Effect';
import type { RsbuildPluginAPI } from '@rsbuild/core';
import { matchRoutes } from 'react-router';
import { dirname, relative, resolve } from 'pathe';
import { PLUGIN_NAME, SPA_FALLBACK_HTML_FILE } from './constants.js';
import { getBuildManifest } from './build-manifest.js';
import {
  createReactRouterManifestOptions,
  generateReactRouterManifestForDev,
  type ReactRouterManifestForDev as ReactRouterManifest,
  type ReactRouterManifestStats,
  type RouteChunkManifestOptions,
  type RouteModuleAnalysisProvider,
  type RouteManifestModuleExports,
} from './manifest.js';
import {
  createPrerenderRoutes,
  getPrerenderConcurrency,
  getSsrFalsePrerenderExportErrors,
  normalizePrerenderMatchPath,
} from './prerender.js';
import type {
  Config,
  ResolvedReactRouterConfig,
} from './react-router-config.js';
import { startServerBuildWorker } from './server-build-worker-client.js';
import type { ServerBuildDescription } from './server-build-worker-protocol.js';
import type { PluginOptions, Route } from './types.js';
import { runPluginEffect, tryPluginPromise } from './effect-runtime.js';

type PrerenderServerBuild = ServerBuildDescription;

type PrerenderBuildApi = Pick<
  RsbuildPluginAPI,
  'logger' | 'getNormalizedConfig'
>;

type RunReactRouterPrerenderBuildOptions = {
  api: PrerenderBuildApi;
  hasWebEnvironment: boolean;
  buildDirectory: string;
  serverBuildFile?: string;
  ssr: boolean;
  isPrerenderEnabled: boolean;
  prerenderConfig: Config['prerender'];
  prerenderPaths: string[];
  basename: string;
  future: ResolvedReactRouterConfig['future'];
  routes: Record<string, Route>;
  latestBrowserManifest: ReactRouterManifest | null;
  latestBrowserManifestModuleExports: RouteManifestModuleExports;
  clientStats: ReactRouterManifestStats | undefined;
  pluginOptions: PluginOptions;
  appDirectory: string;
  assetPrefix: string;
  routeChunkOptions: RouteChunkManifestOptions | undefined;
  routeModuleAnalysis?: RouteModuleAnalysisProvider;
  buildManifest: Awaited<ReturnType<typeof getBuildManifest>>;
  buildEndReactRouterConfig: ResolvedReactRouterConfig;
  buildEnd: Config['buildEnd'];
};

const redirectStatusCodes = new Set([301, 302, 303, 307, 308]);

const getServerBuildPath = async ({
  buildDirectory,
  serverBuildFile,
}: {
  buildDirectory: string;
  serverBuildFile?: string;
}): Promise<{ serverBuildDir: string; serverBuildPath: string }> => {
  const serverBuildDir = resolve(buildDirectory, 'server');
  const defaultServerBuildFile = 'static/js/app.js';
  const configuredServerBuildFile = serverBuildFile || 'index.js';
  const configuredServerBuildPath = resolve(
    serverBuildDir,
    configuredServerBuildFile
  );
  const defaultServerBuildPath = resolve(
    serverBuildDir,
    defaultServerBuildFile
  );

  if (
    configuredServerBuildFile !== defaultServerBuildFile &&
    existsSync(defaultServerBuildPath) &&
    !existsSync(configuredServerBuildPath)
  ) {
    await mkdir(dirname(configuredServerBuildPath), { recursive: true });
    await fsExtra.copy(defaultServerBuildPath, configuredServerBuildPath);
  }

  return {
    serverBuildDir,
    serverBuildPath: existsSync(configuredServerBuildPath)
      ? configuredServerBuildPath
      : defaultServerBuildPath,
  };
};

const createDataRequestPath = (
  prerenderPath: string,
  trailingSlashAwareDataRequests: boolean
): string => {
  if (trailingSlashAwareDataRequests) {
    return prerenderPath.endsWith('/')
      ? `${prerenderPath}_.data`
      : `${prerenderPath}.data`;
  }

  return prerenderPath === '/'
    ? '/_root.data'
    : `${prerenderPath.replace(/\/$/, '')}.data`;
};

export const createBuildRequestEffect = <T>(
  input: string | URL,
  init: RequestInit | undefined,
  handle: (request: Request) => Promise<T>
): Effect.Effect<T, Error, never> =>
  Effect.acquireUseRelease(
    Effect.sync(() => new AbortController()),
    controller =>
      tryPluginPromise(() =>
        handle(
          new Request(input, {
            ...init,
            signal: controller.signal,
          })
        )
      ),
    controller =>
      Effect.sync(() => {
        controller.abort();
      })
  );

export const withBuildRequest = <T>(
  input: string | URL,
  init: RequestInit | undefined,
  handle: (request: Request) => Promise<T>
): Promise<T> => runPluginEffect(createBuildRequestEffect(input, init, handle));

const prerenderDataEffect = ({
  handler,
  prerenderPath,
  onlyRoutes,
  clientBuildDir,
  basename,
  trailingSlashAwareDataRequests,
  api,
  requestInit,
}: {
  handler: (request: Request) => Promise<Response>;
  prerenderPath: string;
  onlyRoutes: string[] | null;
  clientBuildDir: string;
  basename: string;
  trailingSlashAwareDataRequests: boolean;
  api: PrerenderBuildApi;
  requestInit?: RequestInit;
}) => {
  const dataOutputPath = createDataRequestPath(
    prerenderPath,
    trailingSlashAwareDataRequests
  );
  // The handler always serves the root route's data at /_root.data, even when
  // trailing-slash-aware naming writes the root output to /_.data.
  const dataRequestPath =
    trailingSlashAwareDataRequests && prerenderPath === '/'
      ? '/_root.data'
      : dataOutputPath;
  const normalizedPath = `${basename}${dataRequestPath}`.replace(/\/\/+/g, '/');
  const outputNormalizedPath =
    dataOutputPath === dataRequestPath
      ? normalizedPath
      : `${basename}${dataOutputPath}`.replace(/\/\/+/g, '/');
  const url = new URL(`http://localhost${normalizedPath}`);
  if (onlyRoutes?.length) {
    url.searchParams.set('_routes', onlyRoutes.join(','));
  }

  return createBuildRequestEffect(url, requestInit, async request => {
    const response = await handler(request);
    const data = await response.text();

    if (response.status !== 200 && response.status !== 202) {
      throw new Error(
        `Prerender (data): Received a ${response.status} status code from ` +
          `\`entry.server.tsx\` while prerendering the \`${prerenderPath}\` path.\n` +
          `${normalizedPath}`
      );
    }

    const outputPath = resolve(
      clientBuildDir,
      ...outputNormalizedPath.split('/')
    );
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, data);
    api.logger.info(
      `Prerender (data): ${prerenderPath} -> ${relative(
        process.cwd(),
        outputPath
      )}`
    );
    return data;
  });
};

const prerenderRouteEffect = ({
  handler,
  prerenderPath,
  clientBuildDir,
  basename,
  api,
  requestInit,
}: {
  handler: (request: Request) => Promise<Response>;
  prerenderPath: string;
  clientBuildDir: string;
  basename: string;
  api: PrerenderBuildApi;
  requestInit?: RequestInit;
}) => {
  const normalizedPath = `${basename}${prerenderPath}/`.replace(/\/\/+/g, '/');
  return createBuildRequestEffect(
    `http://localhost${normalizedPath}`,
    requestInit,
    async request => {
      const response = await handler(request);
      let html = await response.text();

      if (redirectStatusCodes.has(response.status)) {
        const location = response.headers.get('Location');
        const delay = response.status === 302 ? 2 : 0;
        html = `<!doctype html>
<head>
<title>Redirecting to: ${location}</title>
<meta http-equiv="refresh" content="${delay};url=${location}">
<meta name="robots" content="noindex">
</head>
<body>
\t<a href="${location}">
    Redirecting from <code>${normalizedPath}</code> to <code>${location}</code>
  </a>
</body>
</html>`;
      } else if (response.status !== 200) {
        throw new Error(
          `Prerender (html): Received a ${response.status} status code from ` +
            `\`entry.server.tsx\` while prerendering the \`${normalizedPath}\` path.\n` +
            html
        );
      }

      const outputPath = resolve(
        clientBuildDir,
        ...normalizedPath.split('/'),
        'index.html'
      );
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, html);
      api.logger.info(
        `Prerender (html): ${prerenderPath} -> ${relative(
          process.cwd(),
          outputPath
        )}`
      );
    }
  );
};

const prerenderResourceRouteEffect = ({
  handler,
  prerenderPath,
  clientBuildDir,
  basename,
  api,
  requestInit,
}: {
  handler: (request: Request) => Promise<Response>;
  prerenderPath: string;
  clientBuildDir: string;
  basename: string;
  api: PrerenderBuildApi;
  requestInit?: RequestInit;
}) => {
  const normalizedPath = `${basename}${prerenderPath}/`
    .replace(/\/\/+/g, '/')
    .replace(/\/$/g, '');
  return createBuildRequestEffect(
    `http://localhost${normalizedPath}`,
    requestInit,
    async request => {
      const response = await handler(request);
      const content = Buffer.from(await response.arrayBuffer());

      if (response.status !== 200) {
        throw new Error(
          `Prerender (resource): Received a ${response.status} status code from ` +
            `\`entry.server.tsx\` while prerendering the \`${normalizedPath}\` path.\n` +
            content.toString('utf8')
        );
      }

      const outputPath = resolve(clientBuildDir, ...normalizedPath.split('/'));
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, content);
      api.logger.info(
        `Prerender (resource): ${prerenderPath} -> ${relative(
          process.cwd(),
          outputPath
        )}`
      );
    }
  );
};

const handleSpaMode = async ({
  handler,
  build,
  clientBuildDir,
  basename,
  api,
}: {
  handler: (request: Request) => Promise<Response>;
  build: PrerenderServerBuild;
  clientBuildDir: string;
  basename: string;
  api: PrerenderBuildApi;
}): Promise<void> => {
  await withBuildRequest(
    `http://localhost${basename}`,
    {
      headers: {
        'X-React-Router-SPA-Mode': 'yes',
      },
    },
    async request => {
      const response = await handler(request);
      const html = await response.text();
      const isPrerenderSpaFallback = build.prerender?.includes('/');
      const filename = isPrerenderSpaFallback
        ? SPA_FALLBACK_HTML_FILE
        : 'index.html';

      if (response.status !== 200) {
        if (isPrerenderSpaFallback) {
          throw new Error(
            `Prerender: Received a ${response.status} status code from ` +
              `\`entry.server.tsx\` while prerendering your \`${filename}\` file.\n` +
              html
          );
        }
        throw new Error(
          `SPA Mode: Received a ${response.status} status code from ` +
            '`entry.server.tsx` while prerendering your SPA Fallback HTML file.\n' +
            html
        );
      }

      if (
        !html.includes('window.__reactRouterContext =') ||
        !html.includes('window.__reactRouterRouteModules =')
      ) {
        throw new Error(
          'SPA Mode: Did you forget to include `<Scripts/>` in your root route? ' +
            'Your pre-rendered HTML cannot hydrate without `<Scripts />`.'
        );
      }

      const outputPath = resolve(clientBuildDir, filename);
      await writeFile(outputPath, html);
      const prettyPath = relative(process.cwd(), outputPath);
      if (build.prerender?.length) {
        api.logger.info(`Prerender (html): SPA Fallback -> ${prettyPath}`);
      } else {
        api.logger.info(`SPA Mode: Generated ${prettyPath}`);
      }
    }
  );
};

const assertValidSsrFalsePrerenderExports = ({
  routes,
  manifestRoutes,
  routeExports,
  prerenderPaths,
  api,
}: {
  routes: Record<string, Route>;
  manifestRoutes: ReactRouterManifest['routes'];
  routeExports: RouteManifestModuleExports;
  prerenderPaths: string[];
  api: PrerenderBuildApi;
}) => {
  const errors = getSsrFalsePrerenderExportErrors({
    routes,
    manifestRoutes,
    routeExports,
    prerenderPaths,
  });
  if (errors.length > 0) {
    api.logger.error(errors.join('\n'));
    throw new Error(
      'Invalid route exports found when prerendering with `ssr:false`'
    );
  }
};

const validatePrerenderPathMatches = (
  routes: Record<string, Route>,
  prerenderPaths: string[]
): void => {
  const routeTree = createPrerenderRoutes(routes);
  for (const path of prerenderPaths) {
    const matches = matchRoutes(routeTree, normalizePrerenderMatchPath(path));
    if (!matches) {
      throw new Error(
        `Unable to prerender path because it does not match any routes: ${path}`
      );
    }
  }
};

export const createBoundedPrerenderTasksEffect = <T>(
  prerenderPaths: T[],
  concurrency: number,
  renderPath: (path: T) => Effect.Effect<void, Error, never>
): Effect.Effect<void, Error, never> =>
  Effect.forEach(prerenderPaths, renderPath, { concurrency, discard: true });

const createPrerenderPathEffect = ({
  path,
  build,
  buildRoutes,
  requestHandler,
  clientBuildDir,
  options,
}: {
  path: string;
  build: PrerenderServerBuild;
  buildRoutes: ReturnType<typeof createPrerenderRoutes>;
  requestHandler: (request: Request) => Promise<Response>;
  clientBuildDir: string;
  options: RunReactRouterPrerenderBuildOptions;
}): Effect.Effect<void, Error, never> =>
  Effect.gen(function* () {
    const { api, basename, future } = options;
    const matches = matchRoutes(buildRoutes, normalizePrerenderMatchPath(path));
    if (!matches) {
      return;
    }

    const leafRoute = matches[matches.length - 1]?.route;
    const routeId = leafRoute?.id;
    const manifestRoute = routeId ? build.routes?.[routeId]?.module : null;
    const isResourceRoute =
      manifestRoute && !manifestRoute.default && !manifestRoute.ErrorBoundary;

    if (isResourceRoute) {
      if (manifestRoute.loader && routeId) {
        yield* prerenderDataEffect({
          handler: requestHandler,
          prerenderPath: path,
          onlyRoutes: [routeId],
          clientBuildDir,
          basename,
          trailingSlashAwareDataRequests:
            future.unstable_trailingSlashAwareDataRequests,
          api,
        });
        yield* prerenderResourceRouteEffect({
          handler: requestHandler,
          prerenderPath: path,
          clientBuildDir,
          basename,
          api,
        });
      } else {
        yield* Effect.sync(() => {
          api.logger.warn(
            `⚠️ Skipping prerendering for resource route without a loader: ${routeId}`
          );
        });
      }
      return;
    }

    const hasLoaders = matches.some(match => {
      const matchedRouteId = match.route.id;
      if (!matchedRouteId) {
        return false;
      }
      return build.assets?.routes?.[matchedRouteId]?.hasLoader;
    });
    const data = hasLoaders
      ? yield* prerenderDataEffect({
          handler: requestHandler,
          prerenderPath: path,
          onlyRoutes: null,
          clientBuildDir,
          basename,
          trailingSlashAwareDataRequests:
            future.unstable_trailingSlashAwareDataRequests,
          api,
        })
      : undefined;

    yield* prerenderRouteEffect({
      handler: requestHandler,
      prerenderPath: path,
      clientBuildDir,
      basename,
      api,
      requestInit: data ? createPrerenderDataRequestInit(data) : undefined,
    });
  });

const createPrerenderDataRequestInit = (
  data: string
): RequestInit | undefined => {
  const encodedData = encodeURI(data);
  return encodedData.length < 8 * 1024
    ? {
        headers: {
          'X-React-Router-Prerender-Data': encodedData,
        },
      }
    : undefined;
};

export const runReactRouterPrerenderBuild = async (
  options: RunReactRouterPrerenderBuildOptions
): Promise<void> => {
  if (!options.hasWebEnvironment) {
    return;
  }

  const {
    api,
    buildDirectory,
    serverBuildFile,
    ssr,
    isPrerenderEnabled,
    prerenderConfig,
    prerenderPaths,
    routes,
    latestBrowserManifest,
    latestBrowserManifestModuleExports,
    clientStats,
    pluginOptions,
    appDirectory,
    assetPrefix,
    routeChunkOptions,
    routeModuleAnalysis,
    buildManifest,
    buildEndReactRouterConfig,
    buildEnd,
    basename,
  } = options;
  const { serverBuildDir, serverBuildPath } = await getServerBuildPath({
    buildDirectory,
    serverBuildFile,
  });
  const clientBuildDir = resolve(buildDirectory, 'client');

  if (!existsSync(serverBuildPath)) {
    console.warn(
      `[${PLUGIN_NAME}] Server build not found at ${serverBuildPath}. ` +
        'Skipping prerendering.'
    );
    return;
  }

  await mkdir(clientBuildDir, { recursive: true });

  if (!ssr || isPrerenderEnabled) {
    // The server bundle runs in a worker that is terminated afterwards, so a
    // handle its module graph opens cannot keep the build alive (#135).
    const worker = await startServerBuildWorker({
      serverBuildPath,
      mode: 'classic',
    });
    try {
      const build: PrerenderServerBuild | undefined = worker.description;
      if (!build) {
        throw new Error(
          `[${PLUGIN_NAME}] Server build worker returned no build description`
        );
      }
      const requestHandler = worker.handler;

      if (isPrerenderEnabled) {
        if (!ssr) {
          const generated = latestBrowserManifest
            ? {
                manifest: latestBrowserManifest,
                moduleExportsByRouteId: latestBrowserManifestModuleExports,
              }
            : await generateReactRouterManifestForDev(
                routes,
                pluginOptions,
                clientStats,
                appDirectory,
                assetPrefix,
                createReactRouterManifestOptions({
                  routeChunks: routeChunkOptions,
                  routeModuleAnalysis,
                })
              );
          assertValidSsrFalsePrerenderExports({
            routes,
            manifestRoutes: generated.manifest.routes,
            routeExports: generated.moduleExportsByRouteId,
            prerenderPaths,
            api,
          });
        }

        validatePrerenderPathMatches(routes, prerenderPaths);

        if (prerenderPaths.length > 0) {
          api.logger.info(
            `Prerender (html): ${prerenderPaths.length} path(s)...`
          );
        }

        const buildRoutes = createPrerenderRoutes(build.routes);
        await runPluginEffect(
          createBoundedPrerenderTasksEffect(
            prerenderPaths,
            getPrerenderConcurrency(prerenderConfig),
            path =>
              createPrerenderPathEffect({
                path,
                build,
                buildRoutes,
                requestHandler,
                clientBuildDir,
                options,
              })
          )
        );
      }

      if (!ssr) {
        await handleSpaMode({
          handler: requestHandler,
          build,
          clientBuildDir,
          basename,
          api,
        });
      }
    } finally {
      await worker.close();
    }
  }

  if (!ssr) {
    await fsExtra.remove(serverBuildDir);
    api.logger.info(
      `[${PLUGIN_NAME}] Removed server build (static deployment)`
    );
  }

  if (buildEnd) {
    await buildEnd({
      buildManifest,
      reactRouterConfig: buildEndReactRouterConfig,
      rsbuildConfig: api.getNormalizedConfig(),
    });
  }
};
