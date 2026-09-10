import { createHash } from 'node:crypto';
import type { Route, PluginOptions } from './types.js';
import type { RsbuildPluginAPI, Rspack } from '@rsbuild/core';
import {
  createReactRouterManifestOptions,
  createReactRouterManifestStats,
  generateReactRouterManifestForDev,
  getReactRouterManifestChunkNames,
  getReactRouterManifestPath,
  isManifestJsAsset,
  type ReactRouterManifestForDev as ReactRouterManifest,
  type RouteChunkManifestOptions,
  type RouteManifestModuleExports,
  type RouteModuleAnalysisProvider,
} from './manifest.js';
import { combineURLs } from './plugin-utils.js';
import jsesc from 'jsesc';

type StatsAssetWithIntegrity = {
  name?: string;
  integrity?: unknown;
};

type StatsWithIntegrity = {
  assets?: StatsAssetWithIntegrity[];
};

type CompilationAssetWithIntegrity = {
  name: string;
  source?: { source(): string | Buffer };
  info?: {
    integrity?: unknown;
  };
};

type CompilationWithIntegrityAssets =
  | {
      getAssets?: () => readonly CompilationAssetWithIntegrity[];
    }
  | Pick<Rspack.Compilation, 'getAssets'>;

type ModifyBrowserManifestOptions = {
  subResourceIntegrity?: boolean;
  future?: { unstable_subResourceIntegrity?: boolean };
  manifestChunkNames?: ReadonlySet<string>;
  routeModuleAnalysis?: RouteModuleAnalysisProvider;
  onManifest?: (
    manifest: ReactRouterManifest,
    sri: Record<string, string> | true | undefined,
    moduleExportsByRouteId: RouteManifestModuleExports,
    context: {
      compilation: Rspack.Compilation;
      manifestStats: ReturnType<typeof createReactRouterManifestStats>;
    }
  ) => void;
};

type ProcessAssetsApi = Pick<RsbuildPluginAPI, 'processAssets'>;
type AssetPrefixInput = string | (() => string);
type ManifestProcessAssetsContext = Parameters<
  Parameters<RsbuildPluginAPI['processAssets']>[1]
>[0];

const BROWSER_MANIFEST_ASSET =
  'static/js/virtual/react-router/browser-manifest.js';
const ABSOLUTE_URL_RE = /^[a-zA-Z][a-zA-Z\d+\-.]*:/;

const toManifestAssetUrl = (assetPrefix: string, assetName: string) => {
  if (
    ABSOLUTE_URL_RE.test(assetName) ||
    assetName.startsWith('//') ||
    assetName.startsWith('/')
  ) {
    return assetName;
  }
  return combineURLs(assetPrefix, assetName);
};

const addIntegrity = (
  sri: Record<string, string>,
  assetPrefix: string,
  assetName: unknown,
  integrity: unknown
) => {
  if (
    typeof assetName !== 'string' ||
    !isManifestJsAsset(assetName) ||
    typeof integrity !== 'string'
  ) {
    return;
  }
  sri[toManifestAssetUrl(assetPrefix, assetName)] = integrity;
};

const computeSubresourceIntegrity = (
  source: CompilationAssetWithIntegrity['source']
): string | undefined => {
  if (!source) {
    return undefined;
  }
  return `sha384-${createHash('sha384')
    .update(source.source())
    .digest('base64')}`;
};

export const collectSubresourceIntegrity = (
  stats: StatsWithIntegrity | undefined,
  compilation: CompilationWithIntegrityAssets | undefined,
  assetPrefix = '/'
): Record<string, string> | undefined => {
  const sri: Record<string, string> = {};

  for (const asset of stats?.assets ?? []) {
    addIntegrity(sri, assetPrefix, asset.name, asset.integrity);
  }

  if (typeof compilation?.getAssets === 'function') {
    const assets =
      compilation.getAssets() as readonly CompilationAssetWithIntegrity[];
    for (const asset of assets) {
      if (!isManifestJsAsset(asset.name)) {
        continue;
      }
      addIntegrity(
        sri,
        assetPrefix,
        asset.name,
        computeSubresourceIntegrity(asset.source) ?? asset.info?.integrity
      );
    }
  }

  return Object.keys(sri).length > 0 ? sri : undefined;
};

export function registerModifyBrowserManifestAssets(
  api: ProcessAssetsApi,
  routes: Record<string, Route>,
  pluginOptions: PluginOptions,
  appDirectory: string,
  assetPrefix: AssetPrefixInput = '/',
  routeChunkOptions?: RouteChunkManifestOptions,
  options?: ModifyBrowserManifestOptions
): void {
  const getAssetPrefix =
    typeof assetPrefix === 'function' ? assetPrefix : () => assetPrefix;
  const manifestChunkNames =
    options?.manifestChunkNames ??
    getReactRouterManifestChunkNames(
      routes,
      appDirectory,
      routeChunkOptions?.splitRouteModules
    );
  const isBuild = Boolean(routeChunkOptions?.isBuild);
  const finalizeSri = Boolean(
    isBuild &&
    (options?.subResourceIntegrity ??
      options?.future?.unstable_subResourceIntegrity)
  );

  // Build the React Router manifest from the compilation's current asset names,
  // emit the build-mode `manifest-<version>.js` asset (or replace the dev
  // browser-manifest placeholder), and fire the `onManifest` callback.
  const buildAndEmitManifest = async (
    { assets, sources, compilation }: ManifestProcessAssetsContext,
    { withSri }: { withSri: boolean }
  ): Promise<void> => {
    const currentAssetPrefix = getAssetPrefix();
    const stats = createReactRouterManifestStats(
      compilation,
      manifestChunkNames
    );
    const { manifest, moduleExportsByRouteId } =
      await generateReactRouterManifestForDev(
        routes,
        pluginOptions,
        stats,
        appDirectory,
        currentAssetPrefix,
        createReactRouterManifestOptions({
          routeChunks: routeChunkOptions,
          routeModuleAnalysis: options?.routeModuleAnalysis,
        })
      );
    const browserManifest = { ...manifest };
    delete browserManifest.sri;

    const browserManifestAsset = assets[BROWSER_MANIFEST_ASSET];
    if (browserManifestAsset) {
      const originalSource = browserManifestAsset.source().toString();
      const serializedManifest = jsesc(browserManifest, { es6: true });
      const newSource = originalSource.replace(
        /["'`]PLACEHOLDER["'`]/,
        () => serializedManifest
      );
      compilation.updateAsset(
        BROWSER_MANIFEST_ASSET,
        new sources.RawSource(newSource)
      );
    }

    if (isBuild) {
      const entryAssets = stats?.assetsByChunkName?.['entry.client'];
      const entryJsAssets = entryAssets?.filter(isManifestJsAsset) || [];
      const manifestPath = getReactRouterManifestPath({
        version: manifest.version,
        isBuild: true,
        entryModulePath: entryJsAssets[0],
      });
      const manifestSource = `window.__reactRouterManifest=${jsesc(
        browserManifest,
        { es6: true }
      )};`;
      const source = new sources.RawSource(manifestSource);
      if (compilation.getAsset(manifestPath)) {
        compilation.updateAsset(manifestPath, source);
      } else {
        compilation.emitAsset(manifestPath, source);
      }
    }

    // Rspack's SRI stats are finalized by a later report-stage hook. Hash the
    // finalized JavaScript sources here as a fallback, matching React Router's
    // Vite integration. Browser manifests intentionally omit `sri`; hydration
    // receives it from the server-rendered import map.
    const sri = withSri
      ? (collectSubresourceIntegrity(
          compilation.getStats().toJson({
            all: false,
            assets: true,
          }) as StatsWithIntegrity,
          compilation,
          currentAssetPrefix
        ) ?? true)
      : undefined;

    options?.onManifest?.(manifest, sri, moduleExportsByRouteId, {
      compilation,
      manifestStats: stats,
    });
  };

  // In production, Rspack renames content-hashed assets during
  // `realContentHash` (PROCESS_ASSETS_STAGE_OPTIMIZE_HASH = 2500). Reading
  // asset names before that stage yields pre-rename hashes that never appear
  // in the output, so CSS/JS URLs in the manifest 404. In dev, CSS extraction
  // can also attach entry CSS after `additions`. Defer manifest generation and
  // emission to the `report` stage (PROCESS_ASSETS_STAGE_REPORT = 5000), which
  // runs after the rename, late CSS attachment, and SRI integrity finalization.
  api.processAssets({ stage: 'report', environments: ['web'] }, context =>
    buildAndEmitManifest(context, { withSri: finalizeSri })
  );
}
