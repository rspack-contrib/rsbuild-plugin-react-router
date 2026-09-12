// Internal module: exposes ServerBuild resolution used by dev-runtime code.
// External callers go through the Promise wrappers in server-utils.ts.
import type { ServerBuild } from 'react-router';

const RESOLVABLE_BUILD_EXPORTS = new Set([
  'allowedActionOrigins',
  'assets',
  'assetsBuildDirectory',
  'basename',
  'entry',
  'future',
  'isSpaMode',
  'prerender',
  'publicPath',
  'routeDiscovery',
  'routes',
  'ssr',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return isRecord(value) && typeof value.then === 'function';
}

function isRouteDiscovery(value: unknown): boolean {
  return (
    value === undefined ||
    (isRecord(value) &&
      (value.mode === 'initial' ||
        (value.mode === 'lazy' &&
          (value.manifestPath === undefined ||
            typeof value.manifestPath === 'string'))))
  );
}

async function resolveBuildExports(
  build: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const resolved = { ...build };
  for (const key of Object.keys(build)) {
    if (!RESOLVABLE_BUILD_EXPORTS.has(key)) {
      continue;
    }
    const value = build[key];
    if (typeof value === 'function' && value.length === 0) {
      const result = value();
      resolved[key] = isPromiseLike(result) ? await result : result;
      continue;
    }
    if (isPromiseLike(value)) {
      resolved[key] = await value;
    }
  }
  return resolved;
}

function isServerBuild(value: unknown): value is ServerBuild {
  return Boolean(
    isRecord(value) &&
    isRecord(value.entry) &&
    isRecord(value.entry.module) &&
    typeof value.entry.module.default === 'function' &&
    isRecord(value.routes) &&
    isRecord(value.assets) &&
    typeof value.assetsBuildDirectory === 'string' &&
    (value.basename === undefined || typeof value.basename === 'string') &&
    isRecord(value.future) &&
    typeof value.isSpaMode === 'boolean' &&
    Array.isArray(value.prerender) &&
    typeof value.publicPath === 'string' &&
    isRouteDiscovery(value.routeDiscovery) &&
    typeof value.ssr === 'boolean'
  );
}

async function resolveServerBuildCandidate(
  candidate: unknown
): Promise<ServerBuild | undefined> {
  if (!isRecord(candidate)) {
    return undefined;
  }
  const resolved = await resolveBuildExports(candidate);
  return isServerBuild(resolved) ? resolved : undefined;
}

export async function resolveServerBuildModule(
  buildModule: unknown,
  source: string
): Promise<ServerBuild> {
  try {
    const moduleValue = isPromiseLike(buildModule)
      ? await buildModule
      : buildModule;
    const candidates: Array<() => unknown> = [() => moduleValue];
    if (isRecord(moduleValue)) {
      if ('default' in moduleValue) {
        candidates.push(() => moduleValue.default);
      }
      if ('module.exports' in moduleValue) {
        candidates.push(() => moduleValue['module.exports']);
      }
    }

    for (const getCandidate of candidates) {
      const candidate = await getCandidate();
      const serverBuild = await resolveServerBuildCandidate(candidate);
      if (serverBuild) {
        return serverBuild;
      }
    }
    throw new Error(
      `[rsbuild-plugin-react-router] ${source} did not contain a valid React Router ServerBuild.`
    );
  } catch (cause) {
    throw cause instanceof Error ? cause : new Error(String(cause));
  }
}
