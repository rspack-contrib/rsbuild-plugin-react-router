import type { Route, PluginOptions } from './types.js';
import type { Rspack } from '@rsbuild/core';
import { getReactRouterManifestForDev } from './manifest.js';
import jsesc from 'jsesc';

/**
 * Creates a Webpack/Rspack plugin that modifies the browser manifest
 * @param routes - The routes configuration
 * @param pluginOptions - The plugin options
 * @param appDirectory - The application directory
 * @returns A webpack/rspack plugin
 */
export function createModifyBrowserManifestPlugin(
  routes: Record<string, Route>,
  pluginOptions: PluginOptions,
  appDirectory: string
) {
  return {
    apply(compiler: Rspack.Compiler): void {
      compiler.hooks.emit.tapAsync(
        'ModifyBrowserManifest',
        async (compilation: Rspack.Compilation, callback) => {
          const manifest = await getReactRouterManifestForDev(
            routes,
            pluginOptions,
            compilation.getStats().toJson(),
            appDirectory
          );

          const manifestPath =
            'static/js/virtual/react-router/browser-manifest.js';
          if (compilation.assets[manifestPath]) {
            const originalSource = compilation.assets[manifestPath]
              .source()
              .toString();
            const newSource = originalSource.replace(
              /["'`]PLACEHOLDER["'`]/,
              jsesc(manifest, { es6: true })
            );
            compilation.assets[manifestPath] = {
              source: () => newSource,
              size: () => newSource.length,
              map: () => ({
                version: 3,
                sources: [manifestPath],
                names: [],
                mappings: '',
                file: manifestPath,
                sourcesContent: [newSource],
              }),
              sourceAndMap: () => ({
                source: newSource,
                map: {
                  version: 3,
                  sources: [manifestPath],
                  names: [],
                  mappings: '',
                  file: manifestPath,
                  sourcesContent: [newSource],
                },
              }),
              updateHash: hash => hash.update(newSource),
              buffer: () => Buffer.from(newSource),
            };
          }
          callback();
        }
      );
    },
  };
}
