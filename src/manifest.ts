import { isAbsolute, relative, resolve } from 'pathe';
import type { Route, PluginOptions, RouteManifestItem } from './types.js';
import type { RouteConfigEntry } from '@react-router/dev/routes';
import type { Rspack } from '@rsbuild/core';
import { combineURLs, createRouteId } from './plugin-utils.js';
import { SERVER_EXPORTS, CLIENT_EXPORTS, JS_LOADERS } from './constants.js';
import * as esbuild from 'esbuild';

// Helper functions
export function configRoutesToRouteManifest(
  appDirectory: string,
  routes: RouteConfigEntry[],
  rootId = 'root'
): Record<string, Route> {
  const routeManifest: Record<string, Route> = {};

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

    if (Object.prototype.hasOwnProperty.call(routeManifest, id)) {
      throw new Error(
        `Unable to define routes with duplicate route id: "${id}"`
      );
    }
    routeManifest[id] = manifestItem;

    if (route.children) {
      for (const child of route.children) {
        walk(child, id);
      }
    }
  }

  for (const route of routes) {
    walk(route, rootId);
  }

  return routeManifest;
}

export async function getReactRouterManifestForDev(
  routes: Record<string, Route>,
  //@ts-ignore
  options: PluginOptions,
  clientStats: Rspack.StatsCompilation | undefined,
  context: string
): Promise<{
  version: string;
  url: string;
  entry: {
    module: string;
    imports: string[];
    css: string[];
  };
  routes: Record<string, RouteManifestItem>;
}> {
  const result: Record<string, RouteManifestItem> = {};

  for (const [key, route] of Object.entries(routes)) {
    const assets = clientStats?.assetsByChunkName?.[route.id];
    const jsAssets = assets?.filter(asset => asset.endsWith('.js')) || [];
    const cssAssets = assets?.filter(asset => asset.endsWith('.css')) || [];
    // Read and analyze the route file to check for exports
    const routeFilePath = resolve(context, route.file);
    let exports = new Set<string>();

    try {
      const buildResult = await esbuild.build({
        entryPoints: [routeFilePath],
        bundle: false,
        write: false,
        metafile: true,
        jsx: 'automatic',
        format: 'esm',
        platform: 'neutral',
        loader: JS_LOADERS,
      });

      // Get exports from the metafile
      const entryPoint = Object.values(buildResult.metafile.outputs)[0];
      if (entryPoint?.exports) {
        exports = new Set(entryPoint.exports);
      }
    } catch (error) {
      console.error(`Failed to analyze route file ${routeFilePath}:`, error);
    }

    result[key] = {
      id: route.id,
      parentId: route.parentId,
      path: route.path,
      index: route.index,
      caseSensitive: route.caseSensitive,
      module: combineURLs('/', jsAssets[0] || ''),
      hasAction: exports.has(SERVER_EXPORTS.action),
      hasLoader: exports.has(SERVER_EXPORTS.loader),
      hasClientAction: exports.has(CLIENT_EXPORTS.clientAction),
      hasClientLoader: exports.has(CLIENT_EXPORTS.clientLoader),
      hasErrorBoundary: exports.has(CLIENT_EXPORTS.ErrorBoundary),
      imports: jsAssets.map(asset => combineURLs('/', asset)),
      css: cssAssets.map(asset => combineURLs('/', asset)),
    };
  }

  const entryAssets = clientStats?.assetsByChunkName?.['entry.client'];
  const entryJsAssets =
    entryAssets?.filter(asset => asset.endsWith('.js')) || [];
  const entryCssAssets =
    entryAssets?.filter(asset => asset.endsWith('.css')) || [];

  return {
    version: String(Math.random()),
    url: '/static/js/virtual/react-router/browser-manifest.js',
    entry: {
      module: combineURLs('/', entryJsAssets[0] || ''),
      imports: entryJsAssets.map(asset => combineURLs('/', asset)),
      css: entryCssAssets.map(asset => combineURLs('/', asset)),
    },
    routes: result,
  };
}
