import { normalize, resolve } from 'pathe';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { JS_EXTENSIONS } from './constants.js';

const requireFromApp = createRequire(resolve(process.cwd(), 'package.json'));

export const resolveAppPackagePath = (
  specifier: string
): string | undefined => {
  try {
    return requireFromApp.resolve(specifier);
  } catch {
    return undefined;
  }
};

export const parseVersionMajorMinor = (
  version: string | undefined
): { major: number; minor: number } | undefined => {
  const match = version?.match(/^(\d+)\.(\d+)\./);
  if (!match) {
    return undefined;
  }
  return { major: Number(match[1]), minor: Number(match[2]) };
};

const packageVersionCache = new Map<string, string | undefined>();

export const getPackageVersion = (
  packageName: string,
  resolvePackagePath: (
    specifier: string
  ) => string | undefined = resolveAppPackagePath
): string | undefined => {
  // Only default resolution is cached; injected resolvers (tests) stay live.
  const cacheable = resolvePackagePath === resolveAppPackagePath;
  if (cacheable && packageVersionCache.has(packageName)) {
    return packageVersionCache.get(packageName);
  }
  const packageJsonPath = resolvePackagePath(`${packageName}/package.json`);
  if (!packageJsonPath) {
    return undefined;
  }
  try {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      version?: unknown;
    };
    const version =
      typeof packageJson.version === 'string' ? packageJson.version : undefined;
    if (cacheable) {
      packageVersionCache.set(packageName, version);
    }
    return version;
  } catch {
    if (cacheable) {
      packageVersionCache.set(packageName, undefined);
    }
    return undefined;
  }
};

export const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');

export function combineURLs(baseURL: string, relativeURL: string): string {
  return relativeURL
    ? `${baseURL.replace(/\/+$/, '')}/${relativeURL.replace(/^\/+/, '')}`
    : baseURL;
}

export function normalizeAssetPrefix(assetPrefix?: string): string {
  if (!assetPrefix || assetPrefix === 'auto') {
    return '/';
  }
  return assetPrefix.endsWith('/') ? assetPrefix : `${assetPrefix}/`;
}

type AssetPrefixConfig = {
  dev?: { assetPrefix?: unknown };
  output?: { assetPrefix?: unknown };
};

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

const pickConfiguredAssetPrefix = (
  { dev, output }: AssetPrefixConfig,
  isBuild: boolean
): string | undefined =>
  isBuild
    ? asString(output?.assetPrefix)
    : (asString(dev?.assetPrefix) ?? asString(output?.assetPrefix));

/**
 * Resolve the absolute asset prefix the server build and browser manifest use
 * for asset URLs. In development the effective prefix is `dev.assetPrefix`
 * (which Rsbuild defaults from `server.base`, falling back to
 * `output.assetPrefix`); in a production build it is `output.assetPrefix`.
 *
 * `fallbacks` are consulted in order (e.g. the root config after the web
 * environment) when the preceding config only offers a prefix the server
 * cannot use: `'auto'` and empty values are browser-runtime-only, so a root
 * CDN prefix must survive a web `'auto'`. The choice happens before
 * normalization so that `'auto'` is not first folded into `'/'`.
 *
 * `dev.assetPrefix` may be a boolean on the raw config (`false` disables it);
 * boolean/`'auto'`/empty values ultimately normalize to the root prefix `'/'`.
 */
export function resolveEffectiveAssetPrefix(
  config: AssetPrefixConfig & { isBuild: boolean },
  ...fallbacks: AssetPrefixConfig[]
): string {
  for (const candidate of [config, ...fallbacks]) {
    const prefix = pickConfiguredAssetPrefix(candidate, config.isBuild);
    if (prefix && prefix !== 'auto') {
      return normalizeAssetPrefix(prefix);
    }
  }
  return '/';
}

export function createRouteId(file: string): string {
  return normalize(file.replace(/\.[^/.]+$/, ''));
}

export function findEntryFile(basePath: string): string {
  for (const ext of JS_EXTENSIONS) {
    const filePath = `${basePath}${ext}`;
    if (existsSync(filePath)) {
      return filePath;
    }
  }
  return `${basePath}.tsx`;
}

export function generateWithProps() {
  return `
    import {
      UNSAFE_withComponentProps,
      UNSAFE_withErrorBoundaryProps,
      UNSAFE_withHydrateFallbackProps,
    } from "react-router";

    export const withComponentProps = UNSAFE_withComponentProps;
    export const withHydrateFallbackProps = UNSAFE_withHydrateFallbackProps;
    export const withErrorBoundaryProps = UNSAFE_withErrorBoundaryProps;
  `;
}

export {
  invalidDestructureError,
  removeExports,
  removeUnusedImports,
  validateDestructuredExports,
} from './route-export-pruning.js';
export { transformRoute } from './route-component-transform.js';
