import { existsSync } from 'node:fs';
import type { Config } from '@react-router/dev/config';
import type { RouteConfigEntry } from '@react-router/dev/routes';
import type { RsbuildPlugin, Rspack } from '@rsbuild/core';
import * as esbuild from 'esbuild';
import { createJiti } from 'jiti';
import jsesc from 'jsesc';
import { relative, resolve } from 'pathe';
import { RspackVirtualModulePlugin } from 'rspack-plugin-virtual-module';
import { generate, parse } from './babel.js';
import { PLUGIN_NAME, SERVER_ONLY_ROUTE_EXPORTS } from './constants.js';
import { createDevServerMiddleware } from './dev-server.js';
import {
  generateWithProps,
  removeExports,
  transformRoute,
  findEntryFile,
} from './plugin-utils.js';
import {
  configRoutesToRouteManifest,
  getReactRouterManifestForDev,
} from './manifest.js';
import { generateServerBuild } from './server-utils.js';
import { createModifyBrowserManifestPlugin } from './modify-browser-manifest.js';

export type PluginOptions = {
  /**
   * Whether to disable automatic middleware setup for custom server implementation.
   * Use this when you want to handle server setup manually.
   * @default false
   */
  customServer?: boolean;

  /**
   * The output format for server builds.
   * When set to "module", no package.json will be emitted.
   * @default "module"
   */
  serverOutput?: 'module' | 'commonjs';
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
  options: PluginOptions = {}
): RsbuildPlugin => ({
  name: PLUGIN_NAME,

  async setup(api) {
    const defaultOptions = {
      customServer: false,
      serverOutput: 'module' as const,
    };

    const pluginOptions = {
      ...defaultOptions,
      ...options,
    };

    // Add processAssets hook to emit package.json for node environment
    if (pluginOptions.serverOutput === 'commonjs') {
      api.processAssets(
        {
          stage: 'additional',
          targets: ['node'],
        },
        async ({ compilation }) => {
          const { RawSource } = compilation.compiler.webpack.sources;
          const packageJsonPath = 'package.json';
          const source = new RawSource(
            JSON.stringify({
              type: 'commonjs',
            })
          );

          if (compilation.getAsset(packageJsonPath)) {
            compilation.updateAsset(packageJsonPath, source);
          } else {
            compilation.emitAsset(packageJsonPath, source);
          }
        }
      );
    }

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
          'No react-router.config.ts found, using default configuration.'
        );
        return {} as Config;
      });

    const routesPath = resolve(appDirectory, 'routes.ts');

    // Then read the routes
    const routeConfig = await jiti
      .import<RouteConfigEntry[]>(routesPath, {
        default: true,
      })
      .catch(error => {
        console.error('Failed to load routes.ts:', error);
        console.error('No routes.ts found in app directory.');
        return [] as RouteConfigEntry[];
      });

    // Remove local JS_EXTENSIONS definition - use the imported one instead

    // Remove duplicate findEntryFile implementation
    const entryClientPath = findEntryFile(
      resolve(appDirectory, 'entry.client')
    );
    const entryServerPath = findEntryFile(
      resolve(appDirectory, 'entry.server')
    );

    // Check for server app file
    const serverAppPath = findEntryFile(
      resolve(appDirectory, '../server/index')
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
      resolve(appDirectory, 'root.tsx')
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
        federation: false,
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
                      `${resolve(appDirectory, route.file)}?react-router-route`;
                    return acc;
                  },
                  {} as Record<string, string>
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
                experiments: {
                  outputModule: pluginOptions.serverOutput === 'module',
                },
                externalsType: pluginOptions.serverOutput,
                output: {
                  chunkFormat: pluginOptions.serverOutput,
                  chunkLoading:
                    pluginOptions.serverOutput === 'module'
                      ? 'import'
                      : 'require',
                  workerChunkLoading:
                    pluginOptions.serverOutput === 'module'
                      ? 'import'
                      : 'require',
                  wasmLoading: 'fetch',
                  library: { type: pluginOptions.serverOutput },
                  module: pluginOptions.serverOutput === 'module',
                },
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
              rspack: rspackConfig => {
                if (rspackConfig.plugins) {
                  rspackConfig.plugins.push(
                    createModifyBrowserManifestPlugin(
                      routes,
                      pluginOptions,
                      appDirectory
                    )
                  );
                }
                return rspackConfig;
              },
            },
          });
        }
        return config;
      }
    );

    api.processAssets(
      { stage: 'additional', targets: ['node'] },
      ({ sources, compilation }) => {
        const packageJsonPath = 'package.json';
        const source = new sources.RawSource(
          `{"type": "${pluginOptions.serverOutput}"}`
        );

        if (compilation.getAsset(packageJsonPath)) {
          compilation.updateAsset(packageJsonPath, source);
        } else {
          compilation.emitAsset(packageJsonPath, source);
        }
      }
    );

    // Add manifest transformations
    api.transform(
      {
        test: /virtual\/react-router\/(browser|server)-manifest/,
      },
      async args => {
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
      }
    );

    // Add route transformation
    api.transform(
      {
        resourceQuery: /\?react-router-route/,
      },
      async args => {
        let code = (
          await esbuild.transform(args.code, {
            jsx: 'automatic',
            format: 'esm',
            platform: 'neutral',
            loader: args.resourcePath.endsWith('x') ? 'tsx' : 'ts',
          })
        ).code;

        const defaultExportMatch = code.match(
          /\n\s{0,}([\w\d_]+)\sas default,?/
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
      }
    );
  },
});
