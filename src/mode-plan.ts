import type {
  RsbuildConfig,
  RsbuildEntryDescription,
  RsbuildPluginAPI,
  Rspack,
} from '@rsbuild/core';
import { rspack } from '@rsbuild/core';
import type { RouteConfigEntry } from '@react-router/dev/routes';
import { resolve } from 'pathe';
import type {
  Config,
  ResolvedReactRouterConfig,
} from './react-router-config.js';
import type { RouteChunkCache, RouteChunkConfig } from './route-chunks.js';
import type { DevHmrPlanOptions } from './dev-hmr.js';
import type { Route } from './types.js';
import { createReactRouterDevServerSetup } from './dev-server.js';
import { resolveAppPackagePath } from './plugin-utils.js';
import { resolvePrerenderPaths } from './prerender.js';
import { createReactRouterNodeEntries } from './server-build-plan.js';
import { getSsrExternals } from './ssr-externals.js';
import {
  createClassicBuildArtifacts,
  createClassicVirtualModules,
  createClassicWebRouteEntries,
  type ClassicBuildArtifacts,
} from './classic-mode.js';
import {
  createReactRouterRscDevServerSetup,
  createReactRouterRscResolveAliases,
  createReactRouterRscVirtualModules,
} from './rsc-support.js';

type CommonModePlan = {
  routeChunkConfig: RouteChunkConfig;
  manifestChunkNames: Set<string>;
  webEntries: Record<string, string | RsbuildEntryDescription>;
  nodeEntries: Record<string, string | RsbuildEntryDescription>;
  createVirtualModules(
    publicPath: string,
    jsDistPath: string
  ): Record<string, string>;
  createResolveConfig(rootPath: string): Rspack.Configuration['resolve'];
  server: RsbuildConfig['server'] | undefined;
  webExternalsType: 'module' | undefined;
  webOutput: NonNullable<Rspack.Configuration['output']>;
  webOptimization: NonNullable<Rspack.Configuration['optimization']>;
  nodeExternals: string[] | undefined;
  nodeDependencies: { dependencies?: string[] };
};

export type ClassicModePlan = CommonModePlan & {
  kind: 'classic';
  artifacts: ClassicBuildArtifacts;
  routeChunkOptions: {
    splitRouteModules: Config['splitRouteModules'];
    rootRouteFile: string;
    isBuild: boolean;
    cache: RouteChunkCache;
  };
};

export type RscModePlan = CommonModePlan & {
  kind: 'rsc';
  prerenderPaths: string[];
};

export type ReactRouterModePlan = ClassicModePlan | RscModePlan;

// Fields both mode planners need. Mode-specific inputs live on the
// per-mode option types below so each planner owns only what it uses.
type ModePlanContext = {
  allowedActionOriginsForBuild: string[] | undefined;
  api: RsbuildPluginAPI;
  appDirectory: string;
  basename: string;
  customServer: boolean;
  splitRouteModules: Config['splitRouteModules'];
  isBuild: boolean;
  isSpaMode: boolean;
  prerenderConfig: Config['prerender'];
  routeConfig: RouteConfigEntry[];
  routeDiscovery: Config['routeDiscovery'];
  routes: Record<string, Route>;
  rootRouteFile: string;
  ssr: boolean;
};

type CreateClassicModePlanOptions = ModePlanContext & {
  assetsBuildDirectory: string;
  devHmr?: DevHmrPlanOptions;
  defaultEntryName: string;
  entryServerPath: string;
  finalEntryClientPath: string;
  future: Config['future'];
  hasServerApp: boolean;
  reactRouterConfig: ResolvedReactRouterConfig;
  routeChunkCache: RouteChunkCache;
  serverAppPath: string;
  shouldDependOnWebCompiler: boolean;
};

type CreateRscModePlanOptions = ModePlanContext & {
  buildDirectory: string;
  finalEntryRscClientPath: string;
  finalEntryRscPath: string;
  finalEntryRscSsrPath: string;
  outputClientPath: string;
  pluginName: string;
  serverBuildFile: string | undefined;
};

type CreateReactRouterModePlanOptions =
  | ({ isRscMode: true } & CreateRscModePlanOptions)
  | ({ isRscMode: false } & CreateClassicModePlanOptions);

const RSC_LAYERS = rspack.experiments.rsc.Layers;

const createReactRouterPackageAliases = (): Record<string, string> => {
  const reactRouterPath = resolveAppPackagePath('react-router');
  const reactRouterDomPath = resolveAppPackagePath('react-router/dom');
  return {
    ...(reactRouterPath ? { 'react-router$': reactRouterPath } : {}),
    ...(reactRouterDomPath ? { 'react-router/dom$': reactRouterDomPath } : {}),
  };
};

const createRscModePlan = async ({
  allowedActionOriginsForBuild,
  api,
  appDirectory,
  basename,
  buildDirectory,
  customServer,
  finalEntryRscClientPath,
  finalEntryRscPath,
  finalEntryRscSsrPath,
  isBuild,
  outputClientPath,
  pluginName,
  prerenderConfig,
  routeConfig,
  routeDiscovery,
  routes,
  rootRouteFile,
  serverBuildFile,
  splitRouteModules,
  ssr,
}: CreateRscModePlanOptions): Promise<RscModePlan> => {
  const rscServerEntryName = (serverBuildFile || 'index.js').replace(
    /\.js$/,
    ''
  );
  const prerenderPaths = await resolvePrerenderPaths(
    prerenderConfig,
    ssr,
    routeConfig,
    {
      logWarning: true,
      warn: message => api.logger.warn(message),
    }
  );
  return {
    kind: 'rsc',
    prerenderPaths,
    // RSC route chunking is content-detected; the config value only gates
    // 'enforce' validation, matching upstream's RSC Vite plugin.
    routeChunkConfig: {
      splitRouteModules,
      appDirectory,
      rootRouteFile,
    },
    manifestChunkNames: new Set<string>(['index']),
    webEntries: {
      index: {
        import: finalEntryRscClientPath,
        html: false,
      },
    },
    nodeEntries: {
      [rscServerEntryName]: {
        import: finalEntryRscPath,
        layer: RSC_LAYERS.rsc,
      },
    },
    createVirtualModules: (publicPath: string, jsDistPath: string) =>
      createReactRouterRscVirtualModules({
        allowedActionOrigins: allowedActionOriginsForBuild,
        appDirectory,
        basename,
        buildDirectory,
        isBuild,
        jsDistPath,
        outputClientPath,
        publicPath,
        routeDiscovery,
        routes,
        ssr,
      }),
    createResolveConfig: (rootPath: string) => ({
      modules: [resolve(rootPath, 'node_modules'), 'node_modules'],
      alias: createReactRouterRscResolveAliases(rootPath, {
        entrySsrPath: finalEntryRscSsrPath,
      }),
    }),
    server: !customServer
      ? {
          setup: createReactRouterRscDevServerSetup({
            entryName: rscServerEntryName,
            pluginName,
          }),
        }
      : undefined,
    webExternalsType: undefined,
    webOutput: {
      chunkFormat: 'array-push',
      chunkLoading: 'jsonp',
      workerChunkLoading: 'import-scripts',
      wasmLoading: 'fetch',
      module: false,
    },
    webOptimization: {
      splitChunks: false,
      // Flight resolves client references dynamically by export name. Preserve
      // every export and its public name in production so the manifest can
      // resolve route components, data exports, and React Router boundaries.
      ...(isBuild ? { mangleExports: false, usedExports: false } : {}),
      runtimeChunk: false,
    },
    nodeExternals: undefined,
    nodeDependencies: {},
  };
};

const createClassicModePlan = async ({
  api,
  allowedActionOriginsForBuild,
  appDirectory,
  assetsBuildDirectory,
  basename,
  customServer,
  defaultEntryName,
  devHmr,
  entryServerPath,
  finalEntryClientPath,
  future,
  hasServerApp,
  isBuild,
  isSpaMode,
  prerenderConfig,
  reactRouterConfig,
  routeChunkCache,
  routeConfig,
  routeDiscovery,
  routes,
  rootRouteFile,
  serverAppPath,
  shouldDependOnWebCompiler,
  splitRouteModules,
  ssr,
}: CreateClassicModePlanOptions): Promise<ClassicModePlan> => {
  const routeChunkConfig: RouteChunkConfig = {
    splitRouteModules,
    appDirectory,
    rootRouteFile,
  };
  const routeChunkOptions = {
    splitRouteModules,
    rootRouteFile,
    isBuild,
    cache: routeChunkCache,
  };
  const { manifestChunkNames, webRouteEntries } = createClassicWebRouteEntries({
    appDirectory,
    isBuild,
    routes,
    splitRouteModules: Boolean(splitRouteModules),
  });
  const artifacts = await createClassicBuildArtifacts({
    api,
    defaultEntryName,
    isBuild,
    prerenderConfig,
    reactRouterConfig,
    routeConfig,
    routes,
    rootDirectory: process.cwd(),
    ssr,
    devHmr,
  });
  const reactRouterAliases = createReactRouterPackageAliases();
  return {
    kind: 'classic',
    artifacts,
    routeChunkConfig,
    routeChunkOptions,
    manifestChunkNames,
    webEntries: {
      // `html: false` prevents rsbuild from emitting a stray entry.client.html
      // into build/client; React Router renders HTML itself.
      'entry.client': { import: finalEntryClientPath, html: false },
      'virtual/react-router/browser-manifest': {
        import: 'virtual/react-router/browser-manifest',
        html: false,
      },
      ...webRouteEntries,
    },
    nodeEntries: createReactRouterNodeEntries({
      hasServerApp,
      isBuild,
      serverAppPath,
      entryServerPath,
      serverBuildFile: reactRouterConfig.serverBuildFile,
      defaultEntryName,
      serverBundleEntries: artifacts.serverBundleEntries,
    }),
    createVirtualModules: (publicPath: string, _jsDistPath: string) =>
      createClassicVirtualModules({
        allowedActionOrigins: allowedActionOriginsForBuild,
        appDirectory,
        assetsBuildDirectory,
        basename,
        devHmrRuntimeModule: devHmr?.runtimeModule,
        entryServerPath,
        future,
        isSpaMode,
        prerenderPaths: artifacts.prerenderPaths,
        publicPath,
        routeDiscovery,
        routes,
        routesByServerBundleId: artifacts.routesByServerBundleId,
        ssr,
      }),
    createResolveConfig: () => ({ alias: reactRouterAliases }),
    server: customServer
      ? undefined
      : {
          setup: [
            createReactRouterDevServerSetup({
              loadBuild: artifacts.devRuntime.createBuildLoader(),
            }),
          ],
        },
    webExternalsType: 'module',
    webOutput: {
      chunkFormat: 'module',
      chunkLoading: 'import',
      workerChunkLoading: 'import',
      wasmLoading: 'fetch',
      library: { type: 'module' },
      module: true,
      // Async chunk filenames are left to Rsbuild, which derives them from
      // `output.filename.js`, `output.filenameHash`, and `distPath.jsAsync`,
      // so user configuration governs every JavaScript filename (#129).
    },
    webOptimization: {
      avoidEntryIife: true,
      runtimeChunk: 'single',
      // Classic mode resolves route modules through the browser manifest by
      // chunk, not by export name, so production builds can mangle export
      // names and drop exports nothing imports across the whole graph. RSC
      // mode must keep every export name; see createRscModePlan.
      ...(isBuild ? { mangleExports: 'size', usedExports: 'global' } : {}),
    },
    nodeExternals: Array.from(
      new Set(['express', ...getSsrExternals(process.cwd())])
    ),
    nodeDependencies: shouldDependOnWebCompiler
      ? { dependencies: ['web'] }
      : {},
  };
};

export const createReactRouterModePlan = (
  options: CreateReactRouterModePlanOptions
): Promise<ReactRouterModePlan> =>
  options.isRscMode
    ? createRscModePlan(options)
    : createClassicModePlan(options);
