import { createHash } from 'node:crypto';
import { dirname, isAbsolute, relative, resolve } from 'pathe';
import * as Effect from 'effect/Effect';
import type { Route, PluginOptions, RouteManifestItem } from './types.js';
import { combineURLs, createRouteId } from './plugin-utils.js';
import {
  CLIENT_EXPORTS,
  DEFAULT_JS_DIST_PATH,
  SERVER_EXPORTS,
} from './constants.js';
import {
  buildManifestChunkValidity,
  createEmptyRouteChunkByExportName,
  detectRouteChunksIfEnabled,
  getRouteChunkEntryName,
  getRouteEntryBaseName,
  routeChunkExportNames,
  validateRouteChunks,
  type RouteChunkCache,
  type RouteChunkConfig,
  type RouteChunkExportName,
} from './route-chunks.js';
import {
  getRouteModuleAnalysis,
  type RouteModuleAnalysis,
} from './export-utils.js';
import { getCappedPluginConcurrency } from './concurrency.js';
import { runPluginEffect, tryPluginPromise } from './effect-runtime.js';

const ROUTE_ANALYSIS_CONCURRENCY = getCappedPluginConcurrency();

/**
 * Structural equivalent of `RouteConfigEntry` from `@react-router/dev/routes`,
 * inlined so the public declaration files do not reference a devDependency
 * (which would fail to resolve for consumers with `skipLibCheck: false`).
 */
export interface RouteConfigEntry {
  id?: string;
  path?: string;
  index?: boolean;
  caseSensitive?: boolean;
  file: string;
  children?: RouteConfigEntry[];
}

export function configRoutesToRouteManifest(
  appDirectory: string,
  routes: RouteConfigEntry[],
  rootId = 'root'
): Record<string, Route> {
  return Object.fromEntries(
    configRoutesToRouteManifestEntries(appDirectory, routes, rootId)
  );
}

export function configRoutesToRouteManifestEntries(
  appDirectory: string,
  routes: RouteConfigEntry[],
  rootId = 'root'
): Array<[string, Route]> {
  const routeManifestEntries: Array<[string, Route]> = [];
  const routeIds = new Set<string>();

  function walk(route: RouteConfigEntry, parentId: string) {
    const id = route.id || createRouteId(route.file);
    const manifestItem = {
      id,
      parentId,
      file: isAbsolute(route.file)
        ? relative(appDirectory, route.file)
        : route.file,
      path: route.path,
      index: route.index,
      caseSensitive: route.caseSensitive,
    };

    if (routeIds.has(id)) {
      throw new Error(
        `Unable to define routes with duplicate route id: "${id}"`
      );
    }
    routeIds.add(id);
    routeManifestEntries.push([id, manifestItem]);

    if (route.children) {
      for (const child of route.children) {
        walk(child, id);
      }
    }
  }

  for (const route of routes) {
    walk(route, rootId);
  }

  return routeManifestEntries;
}

export type RouteChunkManifestOptions = {
  splitRouteModules?: boolean | 'enforce';
  rootRouteFile?: string;
  isBuild?: boolean;
  cache?: RouteChunkCache;
};

export type RouteModuleAnalysisProvider = (
  routeFilePath: string,
  route: Route
) => Promise<RouteModuleAnalysis | undefined>;

export type ReactRouterManifestOptions = RouteChunkManifestOptions & {
  routeModuleAnalysis?: RouteModuleAnalysisProvider;
};

export const createReactRouterManifestOptions = ({
  routeChunks,
  routeModuleAnalysis,
}: {
  routeChunks?: RouteChunkManifestOptions;
  routeModuleAnalysis?: RouteModuleAnalysisProvider;
}): ReactRouterManifestOptions | undefined => {
  if (!routeChunks && !routeModuleAnalysis) {
    return undefined;
  }
  return {
    ...routeChunks,
    ...(routeModuleAnalysis ? { routeModuleAnalysis } : {}),
  };
};

export type ReactRouterManifestForDev = {
  version: string;
  url: string;
  hmr?: {
    runtime: string;
  };
  entry: {
    module: string;
    imports: string[];
    css: string[];
  };
  sri?: Record<string, string> | true;
  routes: Record<string, RouteManifestItem>;
};

export type ReactRouterManifestStats = {
  assetsByChunkName?: Record<string, string[]>;
  entrypointFilesByName?: Record<string, string[]>;
};

type ReactRouterManifestStatsChunk = {
  files?: Iterable<string>;
};

type ReactRouterManifestStatsEntrypoint = {
  getFiles?: () => Iterable<string>;
};

type ReactRouterManifestStatsLookup<T> = Iterable<
  [string, T | null | undefined]
> & {
  get?: (name: string) => T | null | undefined;
};

type ReactRouterManifestStatsCompilation = {
  namedChunks: ReactRouterManifestStatsLookup<ReactRouterManifestStatsChunk>;
  entrypoints?: ReactRouterManifestStatsLookup<ReactRouterManifestStatsEntrypoint>;
};

// Emitted asset names may carry a query (`output.filename.js:
// '[name].js?v=[contenthash:8]'`); classify on the pathname but keep the full
// reference, since the query is part of the URL the browser must request.
// A chunk's own script is whatever JavaScript the compilation rendered for it,
// regardless of `output.filename` scheme. In development, HMR update files are
// also recorded on `chunk.files`; they are never the module to load.
export const isManifestJsAsset = (asset: string): boolean =>
  /(?<!\.hot-update)\.[cm]?js(?:\?.*)?$/.test(asset);

export const isManifestCssAsset = (asset: string): boolean =>
  /\.css(?:\?.*)?$/.test(asset);

/**
 * Browser JavaScript assets rspack's RSC manifest would drop: it only records
 * chunk files whose emitted name ends in ".js", so `.mjs`/`.cjs` names and
 * query-hash names (`[name].js?v=...`) vanish from `entryJsFiles` and the
 * client manifest.
 */
export const collectUnsupportedRscScriptAssets = (compilation: {
  chunks: Iterable<{ files?: Iterable<string> }>;
}): string[] => {
  const unsupported = new Set<string>();
  for (const chunk of compilation.chunks) {
    for (const file of chunk.files ?? []) {
      if (isManifestJsAsset(file) && !file.endsWith('.js')) {
        unsupported.add(file);
      }
    }
  }
  return [...unsupported];
};

const collectManifestFilesByName = <T>(
  items: ReactRouterManifestStatsLookup<T>,
  names: ReadonlySet<string> | undefined,
  getFiles: (name: string, item: T) => string[]
): Record<string, string[]> => {
  const filesByName: Record<string, string[]> = {};
  if (!names) {
    for (const [name, item] of items) {
      if (item == null) {
        continue;
      }
      filesByName[name] = getFiles(name, item);
    }
    return filesByName;
  }

  const missingNames = new Set(names);
  if (typeof items.get === 'function') {
    for (const name of names) {
      const item = items.get(name);
      if (item == null) {
        continue;
      }
      filesByName[name] = getFiles(name, item);
      missingNames.delete(name);
    }
  }

  if (missingNames.size === 0) {
    return filesByName;
  }

  for (const [name, item] of items) {
    if (!missingNames.has(name)) {
      continue;
    }
    if (item == null) {
      continue;
    }
    filesByName[name] = getFiles(name, item);
    missingNames.delete(name);
    if (missingNames.size === 0) {
      break;
    }
  }

  return filesByName;
};

export const createReactRouterManifestStats = (
  compilation: ReactRouterManifestStatsCompilation | undefined,
  chunkNames?: ReadonlySet<string>
): ReactRouterManifestStats | undefined => {
  if (!compilation) {
    return undefined;
  }

  const assetsByChunkName = collectManifestFilesByName(
    compilation.namedChunks,
    chunkNames,
    (_chunkName, chunk) => Array.from(chunk.files ?? [])
  );
  const entrypointFilesByName = compilation.entrypoints
    ? collectManifestFilesByName(
        compilation.entrypoints,
        chunkNames,
        (_name, entrypoint) => Array.from(entrypoint.getFiles?.() ?? [])
      )
    : {};

  return Object.keys(entrypointFilesByName).length > 0
    ? { assetsByChunkName, entrypointFilesByName }
    : { assetsByChunkName };
};

export type RouteManifestModuleExports = Record<string, readonly string[]>;

export type ReactRouterManifestGenerationResult = {
  manifest: ReactRouterManifestForDev;
  moduleExportsByRouteId: RouteManifestModuleExports;
};

type ChunkAssets = {
  js: string[];
  css: string[];
};

type RouteManifestAnalysis = {
  cssAssets: string[];
  exports: Set<string>;
  routeModuleExports: readonly string[];
  hasRouteChunkByExportName: ReturnType<
    typeof createEmptyRouteChunkByExportName
  > | null;
};

const DEFAULT_MANIFEST_DIR = DEFAULT_JS_DIST_PATH;
const CSS_IMPORT_RE = /\.(?:css|less|sass|scss)(?:\?[^'"`]+)?['"`]/;

const createChunkAssetResolver = (
  clientStats: ReactRouterManifestStats | undefined,
  includeEntrypointJs: boolean
): ((chunkName: string) => ChunkAssets) => {
  const chunkAssetsByName = new Map<string, ChunkAssets>();

  return (chunkName: string): ChunkAssets => {
    const cached = chunkAssetsByName.get(chunkName);
    if (cached) {
      return cached;
    }

    const assets = clientStats?.assetsByChunkName?.[chunkName];
    if (!assets) {
      const fallback = `${DEFAULT_MANIFEST_DIR}/${chunkName}.js`;
      const result = { js: [fallback], css: [] };
      chunkAssetsByName.set(chunkName, result);
      return result;
    }

    const cssAssets = new Set<string>();
    const jsAssets = new Set<string>();
    // The chunk's own files come first so `js[0]` is the route module itself;
    // entrypoint files (runtime, shared vendor chunks) follow as `imports`.
    for (const asset of assets) {
      if (isManifestCssAsset(asset)) {
        cssAssets.add(asset);
      } else if (isManifestJsAsset(asset)) {
        jsAssets.add(asset);
      }
    }
    for (const asset of clientStats?.entrypointFilesByName?.[chunkName] ?? []) {
      if (isManifestCssAsset(asset)) {
        cssAssets.add(asset);
      } else if (includeEntrypointJs && isManifestJsAsset(asset)) {
        jsAssets.add(asset);
      }
    }
    if (jsAssets.size === 0) {
      // Compilation metadata exists for this chunk but names no module script.
      // Guessing `<dir>/<chunk>.js` here would turn an identifiable build
      // problem into a browser 404, so surface it at build time instead.
      throw new Error(
        `[react-router] Chunk "${chunkName}" emitted no JavaScript asset the browser manifest can reference (files: ${
          assets.join(', ') || 'none'
        }). Check the web \`output.filename.js\` scheme.`
      );
    }

    const result = { js: [...jsAssets], css: [...cssAssets] };
    chunkAssetsByName.set(chunkName, result);
    return result;
  };
};

const analyzeRouteForManifestEffect = ({
  discoveredCssAssets,
  isBuild,
  routeChunkCache,
  routeChunkConfig,
  routeEntryName,
  routeFilePath,
  route,
  routeModuleAnalysis,
}: {
  discoveredCssAssets: string[];
  isBuild: boolean;
  routeChunkCache: RouteChunkCache | undefined;
  routeChunkConfig: RouteChunkConfig | null;
  routeEntryName: string;
  routeFilePath: string;
  route: Route;
  routeModuleAnalysis?: RouteModuleAnalysisProvider;
}): Effect.Effect<RouteManifestAnalysis, Error, never> =>
  tryPluginPromise(async () => {
    const { code, exports: exportNames } =
      (await routeModuleAnalysis?.(routeFilePath, route)) ??
      (await getRouteModuleAnalysis(routeFilePath));
    const cssAssets =
      !isBuild && discoveredCssAssets.length === 0 && CSS_IMPORT_RE.test(code)
        ? [
            `${DEFAULT_MANIFEST_DIR.replace('/js', '/css')}/${routeEntryName}.css`,
          ]
        : discoveredCssAssets;
    const chunkInfo =
      isBuild && routeChunkConfig
        ? await detectRouteChunksIfEnabled(
            routeChunkCache,
            routeChunkConfig,
            routeFilePath,
            code
          )
        : null;

    return {
      cssAssets,
      exports: new Set(exportNames),
      routeModuleExports: exportNames,
      hasRouteChunkByExportName: chunkInfo?.hasRouteChunkByExportName ?? null,
    };
  }).pipe(
    Effect.catchAll(error => {
      if (isBuild) {
        return Effect.fail(error);
      }
      return Effect.sync(() => {
        console.error(`Failed to analyze route file ${routeFilePath}:`, error);
        return {
          cssAssets: discoveredCssAssets,
          exports: new Set<string>(),
          routeModuleExports: [],
          hasRouteChunkByExportName: null,
        };
      });
    })
  );

const getManifestDirFromEntryAsset = (entryModulePath?: string): string => {
  if (!entryModulePath) {
    return DEFAULT_MANIFEST_DIR;
  }
  const dir = dirname(entryModulePath);
  return dir === '.' ? DEFAULT_MANIFEST_DIR : dir;
};

export const getReactRouterManifestPath = ({
  version,
  isBuild,
  entryModulePath,
}: {
  version: string;
  isBuild: boolean;
  entryModulePath?: string;
}): string => {
  if (!isBuild) {
    return 'static/js/virtual/react-router/browser-manifest.js';
  }
  const dir = getManifestDirFromEntryAsset(entryModulePath);
  return `${dir}/manifest-${version}.js`;
};

export const getReactRouterManifestChunkNames = (
  routes: Record<string, Route>,
  appDirectory: string,
  splitRouteModules: boolean | 'enforce' = false
): Set<string> => {
  const chunkNames = new Set<string>(['entry.client']);
  for (const route of Object.values(routes)) {
    const routeEntryName = getRouteEntryBaseName(route, appDirectory);
    chunkNames.add(routeEntryName);
    if (!splitRouteModules || route.id === 'root') {
      continue;
    }
    for (const exportName of routeChunkExportNames) {
      chunkNames.add(getRouteChunkEntryName(routeEntryName, exportName));
    }
  }
  return chunkNames;
};

const createRouteManifestItem = ({
  route,
  routeEntryName,
  assetPrefix,
  jsAssets,
  routeAnalysis,
  getModulePathForChunk,
  getCssAssetsForChunk,
}: {
  route: Route;
  routeEntryName: string;
  assetPrefix: string;
  jsAssets: string[];
  routeAnalysis: RouteManifestAnalysis;
  getModulePathForChunk: (chunkName: string) => string | undefined;
  getCssAssetsForChunk: (chunkName: string) => string[];
}): RouteManifestItem => {
  const routeChunkMap = routeAnalysis.hasRouteChunkByExportName;
  const chunkEntryName = (exportName: RouteChunkExportName) =>
    routeChunkMap?.[exportName]
      ? getRouteChunkEntryName(routeEntryName, exportName)
      : undefined;
  const chunkModulePath = (exportName: RouteChunkExportName) => {
    const name = chunkEntryName(exportName);
    return name ? getModulePathForChunk(name) : undefined;
  };
  const cssAssets = [
    ...routeAnalysis.cssAssets,
    ...routeChunkExportNames.flatMap(exportName => {
      const name = chunkEntryName(exportName);
      return name ? getCssAssetsForChunk(name) : [];
    }),
  ];

  return {
    id: route.id,
    parentId: route.parentId,
    path: route.path,
    index: route.index,
    caseSensitive: route.caseSensitive,
    module: combineURLs(assetPrefix, jsAssets[0] || ''),
    clientActionModule: chunkModulePath('clientAction'),
    clientLoaderModule: chunkModulePath('clientLoader'),
    clientMiddlewareModule: chunkModulePath('clientMiddleware'),
    hydrateFallbackModule: chunkModulePath('HydrateFallback'),
    hasAction: routeAnalysis.exports.has(SERVER_EXPORTS.action),
    hasLoader: routeAnalysis.exports.has(SERVER_EXPORTS.loader),
    hasClientAction: routeAnalysis.exports.has(CLIENT_EXPORTS.clientAction),
    hasClientLoader: routeAnalysis.exports.has(CLIENT_EXPORTS.clientLoader),
    hasClientMiddleware: routeAnalysis.exports.has(
      CLIENT_EXPORTS.clientMiddleware
    ),
    hasDefaultExport: routeAnalysis.exports.has('default'),
    hasErrorBoundary: routeAnalysis.exports.has(CLIENT_EXPORTS.ErrorBoundary),
    // `module` is `jsAssets[0]`; exclude it from `imports` so the browser
    // manifest does not list the route's own module twice (upstream excludes
    // the entry chunk's own file from its imports list). Otherwise prefetch
    // link computations produce duplicate modulepreload hrefs.
    imports: jsAssets.slice(1).map(asset => combineURLs(assetPrefix, asset)),
    css: Array.from(new Set(cssAssets)).map(asset =>
      combineURLs(assetPrefix, asset)
    ),
  };
};

function generateReactRouterManifestForDevEffect(
  routes: Record<string, Route>,
  clientStats: ReactRouterManifestStats | undefined,
  context: string,
  assetPrefix: string,
  manifestOptions?: ReactRouterManifestOptions
): Effect.Effect<ReactRouterManifestGenerationResult, Error, never> {
  return Effect.gen(function* () {
    const result: Record<string, RouteManifestItem> = {};
    const splitRouteModules = manifestOptions?.splitRouteModules ?? false;
    const enforceSplitRouteModules = splitRouteModules === 'enforce';
    const isBuild = manifestOptions?.isBuild ?? false;
    const routeChunkConfig: RouteChunkConfig | null =
      splitRouteModules && manifestOptions?.rootRouteFile
        ? {
            splitRouteModules,
            appDirectory: context,
            rootRouteFile: manifestOptions.rootRouteFile,
          }
        : null;

    const getAssetsForChunk = createChunkAssetResolver(clientStats, isBuild);
    const getModulePathForChunk = (chunkName: string): string | undefined => {
      const { js: jsAssets } = getAssetsForChunk(chunkName);
      return jsAssets[0] ? combineURLs(assetPrefix, jsAssets[0]) : undefined;
    };
    const getCssAssetsForChunk = (chunkName: string): string[] =>
      getAssetsForChunk(chunkName).css;

    const manifestEntries = yield* Effect.forEach(
      Object.entries(routes),
      ([key, route]) =>
        Effect.gen(function* () {
          const routeEntryName = getRouteEntryBaseName(route, context);
          const { js: jsAssets, css: discoveredCssAssets } =
            getAssetsForChunk(routeEntryName);
          const routeFilePath = resolve(context, route.file);
          const routeAnalysis = yield* analyzeRouteForManifestEffect({
            discoveredCssAssets,
            isBuild,
            routeChunkCache: manifestOptions?.cache,
            routeChunkConfig,
            routeEntryName,
            routeFilePath,
            route,
            routeModuleAnalysis: manifestOptions?.routeModuleAnalysis,
          });

          if (isBuild && enforceSplitRouteModules && routeChunkConfig) {
            validateRouteChunks({
              config: routeChunkConfig,
              id: routeFilePath,
              valid: buildManifestChunkValidity(
                routeAnalysis.exports,
                routeAnalysis.hasRouteChunkByExportName ??
                  createEmptyRouteChunkByExportName()
              ),
            });
          }

          return [
            key,
            createRouteManifestItem({
              route,
              routeEntryName,
              assetPrefix,
              jsAssets,
              routeAnalysis,
              getModulePathForChunk,
              getCssAssetsForChunk,
            }),
            routeAnalysis.routeModuleExports,
          ] as const;
        }),
      {
        concurrency: Math.max(
          1,
          Math.min(ROUTE_ANALYSIS_CONCURRENCY, Object.keys(routes).length)
        ),
      }
    );

    const routeModuleExportsByRouteId: RouteManifestModuleExports = {};
    for (const [
      key,
      routeManifestItem,
      routeModuleExports,
    ] of manifestEntries) {
      result[key] = routeManifestItem;
      routeModuleExportsByRouteId[key] = routeModuleExports;
    }

    const { js: entryJsAssets, css: entryCssAssets } =
      getAssetsForChunk('entry.client');

    const fingerprintedValues = {
      entry: {
        module: combineURLs(assetPrefix, entryJsAssets[0] || ''),
        // Exclude the entry's own module (`entryJsAssets[0]`) from imports so it
        // is not listed twice, matching upstream where `imports` holds only the
        // chunk's dependency imports.
        imports: entryJsAssets
          .slice(1)
          .map(asset => combineURLs(assetPrefix, asset)),
        css: entryCssAssets.map(asset => combineURLs(assetPrefix, asset)),
      },
      routes: result,
    };
    // Content-derived in development too. React Router's stale-client check
    // compares the browser's manifest version with the pinned server build's,
    // and a random per-compilation version made unchanged manifests differ
    // whenever a web compilation completed without a new server pin.
    // sha256 rather than md5: md5 is unavailable on FIPS-enabled hosts (#124).
    const version = createHash('sha256')
      .update(JSON.stringify(fingerprintedValues))
      .digest('hex')
      .slice(0, 8);
    const manifestPath = getReactRouterManifestPath({
      version,
      isBuild,
      entryModulePath: entryJsAssets[0],
    });

    const manifest = {
      version,
      url: combineURLs(
        assetPrefix,
        isBuild ? manifestPath : `${manifestPath}?v=${version}`
      ),
      hmr: undefined,
      entry: fingerprintedValues.entry,
      sri: undefined,
      routes: result,
    };

    return {
      manifest,
      moduleExportsByRouteId: routeModuleExportsByRouteId,
    };
  });
}

export async function generateReactRouterManifestForDev(
  routes: Record<string, Route>,
  _options: PluginOptions,
  clientStats: ReactRouterManifestStats | undefined,
  context: string,
  assetPrefix = '/',
  manifestOptions?: ReactRouterManifestOptions
): Promise<ReactRouterManifestGenerationResult> {
  return runPluginEffect(
    generateReactRouterManifestForDevEffect(
      routes,
      clientStats,
      context,
      assetPrefix,
      manifestOptions
    )
  );
}

export async function getReactRouterManifestForDev(
  ...args: Parameters<typeof generateReactRouterManifestForDev>
): Promise<ReactRouterManifestForDev> {
  return (await generateReactRouterManifestForDev(...args)).manifest;
}
