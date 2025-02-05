import { existsSync } from 'node:fs';
import type { Config } from '@react-router/dev/config';
import type { RouteConfigEntry } from '@react-router/dev/routes';
import type { RsbuildPlugin, Rspack } from '@rsbuild/core';
import * as esbuild from 'esbuild';
import { createJiti } from 'jiti';
import jsesc from 'jsesc';
import { isAbsolute, relative, resolve } from 'pathe';
import { RspackVirtualModulePlugin } from 'rspack-plugin-virtual-module';
import { generate, parse } from './babel.js';
import { PLUGIN_NAME, SERVER_EXPORTS, CLIENT_EXPORTS, SERVER_ONLY_ROUTE_EXPORTS } from './constants.js';
import { createDevServerMiddleware } from './dev-server.js';
import {
  combineURLs,
  createRouteId,
  generateWithProps,
  removeExports,
  transformRoute,
} from './plugin-utils.js';

export type PluginOptions = {
  /**
   * Whether to disable automatic middleware setup for custom server implementation.
   * Use this when you want to handle server setup manually.
   * @default false
   */
  customServer?: boolean;
};


export type Route = {
  id: string;
  parentId?: string;
  file: string;
  path?: string;
  index?: boolean;
  caseSensitive?: boolean;
  children?: Route[];
};

export type RouteManifestItem = Omit<Route, 'file' | 'children'> & {
  module: string;
  hasAction: boolean;
  hasLoader: boolean;
  hasClientAction: boolean;
  hasClientLoader: boolean;
  hasErrorBoundary: boolean;
  imports: string[];
  css: string[];
};

export const pluginReactRouter = (
  options: PluginOptions = {},
): RsbuildPlugin => ({
  name: PLUGIN_NAME,

  async setup(api) {
    const defaultOptions = {
      customServer: false,
    };

    const pluginOptions = {
      ...defaultOptions,
      ...options,
    };

    // Run typegen on build/dev
    api.onBeforeStartDevServer(async () => {
      const { $ } = await import('execa');
       $`npx --yes react-router typegen --watch`;
    });

    api.onBeforeBuild(async () => {
      const { $ } = await import('execa');
       $`npx --yes react-router typegen`;
    });

    const jiti = createJiti(process.cwd());

    // Read the react-router.config.ts file first
    const {
      appDirectory = 'app',
      basename = '/',
      buildDirectory = 'build',
      ssr = true,
    } = await jiti
      .import<Config>('./react-router.config.ts', {
        default: true,
      })
      .catch(() => {
        console.error(
          'No react-router.config.ts found, using default configuration.',
        );
        return {} as Config;
      });

    const routesPath = resolve(appDirectory, 'routes.ts');

    // Then read the routes
    const routeConfig = await jiti
      .import<RouteConfigEntry[]>(routesPath, {
        default: true,
      })
      .catch((error) => {
        console.error('Failed to load routes.ts:', error);
        console.error('No routes.ts found in app directory.');
        return [] as RouteConfigEntry[];
      });

    const jsExtensions = ['.tsx', '.ts', '.jsx', '.js', '.mjs'];

    const findEntryFile = (basePath: string) => {
      for (const ext of jsExtensions) {
        const filePath = `${basePath}${ext}`;
        if (existsSync(filePath)) {
          return filePath;
        }
      }
      return `${basePath}.tsx`; // Default to .tsx if no file exists
    };

    const entryClientPath = findEntryFile(
      resolve(appDirectory, 'entry.client'),
    );
    const entryServerPath = findEntryFile(
      resolve(appDirectory, 'entry.server'),
    );

    // Check for server app file
    const serverAppPath = findEntryFile(
      resolve(appDirectory, '../server/app'),
    );
    const hasServerApp = existsSync(serverAppPath);

    // Add fallback logic for entry files
    const templateDir = resolve(__dirname, 'templates');
    const templateClientPath = resolve(templateDir, 'entry.client.js');
    const templateServerPath = resolve(templateDir, 'entry.server.js');

    // Use template files if user files don't exist
    const finalEntryClientPath = existsSync(entryClientPath)
      ? entryClientPath
      : templateClientPath;
    const finalEntryServerPath = existsSync(entryServerPath)
      ? entryServerPath
      : templateServerPath;

    const rootRouteFile = relative(
      appDirectory,
      resolve(appDirectory, 'root.tsx'),
    );

    const routes = {
      root: { path: '', id: 'root', file: rootRouteFile },
      ...configRoutesToRouteManifest(appDirectory, routeConfig),
    };

    const outputClientPath = resolve(buildDirectory, 'client');
    const assetsBuildDirectory = relative(process.cwd(), outputClientPath);

    let clientStats: Rspack.StatsCompilation | undefined;
    api.onAfterEnvironmentCompile(({ stats, environment }) => {
      if (environment.name === 'web') {
        clientStats = stats?.toJson();
      }
    });

    // Create virtual modules for React Router
    const vmodPlugin = new RspackVirtualModulePlugin({
      'virtual/react-router/browser-manifest': 'export default {};',
      'virtual/react-router/server-manifest': 'export default {};',
      'virtual/react-router/server-build': generateServerBuild(routes, {
        entryServerPath: finalEntryServerPath,
        assetsBuildDirectory,
        basename,
        appDirectory,
        ssr,
      }),
      'virtual/react-router/with-props': generateWithProps(),
    });

    api.modifyRsbuildConfig(async (config, { mergeRsbuildConfig }) => {
      return mergeRsbuildConfig(config, {
        output: {
          assetPrefix: '/',
        },
        dev: {
          writeToDisk: true,
          hmr: false,
          liveReload: true,
          setupMiddlewares: pluginOptions.customServer
            ? []
            : [
                (middlewares, server) => {
                  middlewares.push(createDevServerMiddleware(server));
                },
              ],
        },
        tools: {
          rspack: {
            plugins: [vmodPlugin],
          },
        },
        environments: {
          web: {
            source: {
              entry: {
                'entry.client': finalEntryClientPath,
                'virtual/react-router/browser-manifest':
                  'virtual/react-router/browser-manifest',
                ...Object.values(routes).reduce(
                  (acc: Record<string, string>, route) => {
                    acc[route.file.slice(0, route.file.lastIndexOf('.'))] =
                      `${resolve(
                        appDirectory,
                        route.file,
                      )}?react-router-route`;
                    return acc;
                  },
                  {} as Record<string, string>,
                ),
              },
            },
            output: {
              distPath: {
                root: outputClientPath,
              },
            },
            tools: {
              rspack: {
                name: 'web',
                experiments: {
                  outputModule: true,
                },
                externalsType: 'module',
                output: {
                  chunkFormat: 'module',
                  chunkLoading: 'import',
                  workerChunkLoading: 'import',
                  wasmLoading: 'fetch',
                  library: { type: 'module' },
                  module: true,
                },
                optimization: {
                  runtimeChunk: 'single',
                },
              },
            },
          },
          node: {
            source: {
              entry: {
                ...(hasServerApp
                  ? { app: serverAppPath }
                  : { app: 'virtual/react-router/server-build' }),
                'entry.server': finalEntryServerPath,
              },
            },
            output: {
              distPath: {
                root: resolve(buildDirectory, 'server'),
              },
              target: config.environments?.node?.output?.target || 'node',
              filename: {
                js: 'static/js/[name].js',
              },
            },
            tools: {
              rspack: {
                externals: ['express'],
                dependencies: ['web'],
              },
            },
          },
        },
      });
    });

    // Add environment-specific modifications
    api.modifyEnvironmentConfig(
      async (config, { name, mergeEnvironmentConfig }) => {
        if (name === 'web') {
          return mergeEnvironmentConfig(config, {
            tools: {
              rspack: (rspackConfig) => {
                if (rspackConfig.plugins) {
                  rspackConfig.plugins.push({
                    apply(compiler: Rspack.Compiler) {
                      compiler.hooks.emit.tapAsync(
                        'ModifyBrowserManifest',
                        async (compilation: Rspack.Compilation, callback) => {
                          const manifest = await getReactRouterManifestForDev(
                            routes,
                            pluginOptions,
                            compilation.getStats().toJson(),
                            appDirectory,
                          );

                          const manifestPath =
                            'static/js/virtual/react-router/browser-manifest.js';
                          if (compilation.assets[manifestPath]) {
                            const originalSource = compilation.assets[
                              manifestPath
                            ]
                              .source()
                              .toString();
                            const newSource = originalSource.replace(
                              /["'`]PLACEHOLDER["'`]/,
                              jsesc(manifest, { es6: true }),
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
                              updateHash: (hash) => hash.update(newSource),
                              buffer: () => Buffer.from(newSource),
                            };
                          }
                          callback();
                        },
                      );
                    },
                  });
                }
                return rspackConfig;
              },
            },
          });
        }
        return config;
      },
    );

    api.processAssets(
      { stage: 'additional', targets: ['node'] },
      ({ sources, compilation }) => {
        const source = new sources.RawSource('{"type": "commonjs"}');
        compilation.emitAsset('package.json', source);
      },
    );

    // Add manifest transformations
    api.transform(
      {
        test: /virtual\/react-router\/(browser|server)-manifest/,
      },
      async (args) => {
        // For browser manifest, return a placeholder that will be modified by the plugin
        if (args.environment.name === 'web') {
          return {
            code: `window.__reactRouterManifest = "PLACEHOLDER";`,
          };
        }

        // For server manifest, use the clientStats as before
        const manifest = await getReactRouterManifestForDev(
          routes,
          pluginOptions,
          clientStats,
          appDirectory
        );
        return {
          code: `export default ${jsesc(manifest, { es6: true })};`,
        };
      },
    );

    // Add route transformation
    api.transform(
      {
        resourceQuery: /\?react-router-route/,
      },
      async (args) => {
        let code = (
          await esbuild.transform(args.code, {
            jsx: 'automatic',
            format: 'esm',
            platform: 'neutral',
            loader: args.resourcePath.endsWith('x') ? 'tsx' : 'ts',
          })
        ).code;

        const defaultExportMatch = code.match(
          /\n\s{0,}([\w\d_]+)\sas default,?/,
        );
        if (
          defaultExportMatch &&
          typeof defaultExportMatch.index === 'number'
        ) {
          code =
            code.slice(0, defaultExportMatch.index) +
            code.slice(defaultExportMatch.index + defaultExportMatch[0].length);
          code += `\nexport default ${defaultExportMatch[1]};`;
        }

        const ast = parse(code, { sourceType: 'module' });
        if (args.environment.name === 'web') {
          const mutableServerOnlyRouteExports = [...SERVER_ONLY_ROUTE_EXPORTS];
          removeExports(ast, mutableServerOnlyRouteExports);
        }
        transformRoute(ast);

        return generate(ast, {
          sourceMaps: true,
          filename: args.resource,
          sourceFileName: args.resourcePath,
        });
      },
    );
  },
});

// Helper functions
function configRoutesToRouteManifest(
  appDirectory: string,
  routes: RouteConfigEntry[],
  rootId = 'root',
) {
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
        `Unable to define routes with duplicate route id: "${id}"`,
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

async function getReactRouterManifestForDev(
  routes: Record<string, Route>,
  //@ts-ignore
  options: PluginOptions,
  clientStats: Rspack.StatsCompilation | undefined,
  context: string,
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
    const jsAssets = assets?.filter((asset) => asset.endsWith('.js')) || [];
    const cssAssets = assets?.filter((asset) => asset.endsWith('.css')) || [];
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
        loader: {
          '.ts': 'ts',
          '.tsx': 'tsx',
          '.js': 'js',
          '.jsx': 'jsx'
        },
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
      imports: jsAssets.map((asset) => combineURLs('/', asset)),
      css: cssAssets.map((asset) => combineURLs('/', asset)),
    };
  }

  const entryAssets = clientStats?.assetsByChunkName?.['entry.client'];
  const entryJsAssets =
    entryAssets?.filter((asset) => asset.endsWith('.js')) || [];
  const entryCssAssets =
    entryAssets?.filter((asset) => asset.endsWith('.css')) || [];

  return {
    version: String(Math.random()),
    url: '/static/js/virtual/react-router/browser-manifest.js',
    entry: {
      module: combineURLs('/', entryJsAssets[0] || ''),
      imports: entryJsAssets.map((asset) => combineURLs('/', asset)),
      css: entryCssAssets.map((asset) => combineURLs('/', asset)),
    },
    routes: result,
  };
}

/**
 * Generates the server build module content
 * @param routes The route manifest
 * @param options Build options
 * @returns The generated module content as a string
 */
function generateServerBuild(
  routes: Record<string, Route>,
  options: {
    entryServerPath: string;
    assetsBuildDirectory: string;
    basename: string;
    appDirectory: string;
    ssr: boolean;
  },
): string {
  return `
    import * as entryServer from ${JSON.stringify(options.entryServerPath)};
    ${Object.keys(routes)
      .map((key, index) => {
        const route = routes[key];
        return `import * as route${index} from ${JSON.stringify(
          `${resolve(options.appDirectory, route.file)}?react-router-route`,
        )};`;
      })
      .join('\n')}

    export { default as assets } from "virtual/react-router/server-manifest";
    export const assetsBuildDirectory = ${JSON.stringify(
      options.assetsBuildDirectory,
    )};
    export const basename = ${JSON.stringify(options.basename)};
    export const future = ${JSON.stringify({})};
    export const isSpaMode = ${!options.ssr};
    export const publicPath = "/";
    export const entry = { module: entryServer };
    export const routes = {
      ${Object.keys(routes)
        .map((key, index) => {
          const route = routes[key];
          return `${JSON.stringify(key)}: {
            id: ${JSON.stringify(route.id)},
            parentId: ${JSON.stringify(route.parentId)},
            path: ${JSON.stringify(route.path)},
            index: ${JSON.stringify(route.index)},
            caseSensitive: ${JSON.stringify(route.caseSensitive)},
            module: route${index}
          }`;
        })
        .join(',\n  ')}
    };
  `;
}
