import { existsSync, readFileSync } from 'node:fs';
import fsExtra from 'fs-extra';
import type { Config } from './react-router-config.js';
import type { RouteConfigEntry } from '@react-router/dev/routes';
import { rspack, type RsbuildPlugin, type Rspack } from '@rsbuild/core';
import { relative, resolve } from 'pathe';

import { getDefaultConcurrency } from './concurrency.js';
import { JS_EXTENSIONS, PLUGIN_NAME } from './constants.js';
import { guardReactRouterLazyCompilation } from './lazy-compilation.js';
import {
  findEntryFile,
  resolveAppPackagePath,
  resolveEffectiveAssetPrefix,
} from './plugin-utils.js';
import { resolveReactRouterEntryPaths } from './entry-paths.js';
import { registerReactRouterEnvironmentOutput } from './environment-output.js';
import type { PluginOptions, ReactRouterRSCPluginOptions } from './types.js';
import { resolveReactRouterServerBuild } from './server-utils.js';
import { validatePrerenderConfig } from './prerender.js';
import { runReactRouterPrerenderBuild } from './prerender-build.js';
import { runReactRouterRscPrerenderBuild } from './rsc-prerender.js';
import {
  resolveReactRouterConfigEffect,
  resolveRouteDiscoveryConfig,
  type ResolvedReactRouterConfig,
} from './react-router-config.js';
import {
  collectUnsupportedRscScriptAssets,
  configRoutesToRouteManifest,
  createReactRouterManifestStats,
  type ReactRouterManifestForDev as ReactRouterManifest,
  type ReactRouterManifestStats,
  type RouteManifestModuleExports,
} from './manifest.js';
import type { RouteModuleAnalysis } from './export-utils.js';
import { registerModifyBrowserManifestAssets } from './modify-browser-manifest.js';
import {
  registerBuildOutputTransforms,
  registerSsrAssetRelocation,
} from './build-output-transforms.js';
import { type RouteChunkCache } from './route-chunks.js';
import {
  registerRouteModuleTransformRules,
  shouldUseRouteModuleTransformLoader,
} from './route-module-transform-rules.js';
import {
  executeRouteTransformTask,
  type RouteTransformRunner,
} from './route-transform-tasks.js';
import { getRouteRestartMarkerPath, mergeWatchFiles } from './route-watch.js';
import { validateRouteConfig } from './route-config.js';
import { warnOnClientSourceMaps } from './warnings/warn-on-client-source-maps.js';
import { validatePluginOrderFromConfig } from './validation/validate-plugin-order.js';
import {
  createReactRouterPerformanceProfiler,
  roundMs,
} from './performance.js';
import { mapVirtualModules } from './virtual-modules.js';
import {
  createDevHdrRevisionSignal,
  generateDevHmrRuntimeModule,
  getDevHdrRevisionFilePath,
  isRspackSwcReactRefreshEnabled,
  resolveReactRefreshRuntimePath,
} from './dev-hmr.js';
import {
  createPluginEffectRuntime,
  tryPluginPromise,
} from './effect-runtime.js';
import { registerReactRouterTypegen } from './typegen.js';
import {
  createConfigImporter,
  type ConfigImporter,
  importConfigWithWatchPaths,
} from './config-imports.js';
import {
  createReactRouterRouteTopology,
  createReactRouterRouteWatchFiles,
  registerReactRouterDevBackgroundResources,
} from './dev-background-resources.js';
import {
  assertReactRouterRscConfigSupport,
  assertReactRouterRscSupport,
  registerReactRouterRscRouteTransforms,
  setupReactRouterRscPlugin,
} from './rsc-support.js';
import { createReactRouterModePlan } from './mode-plan.js';
import { createQuerylessRouteImportPlugin } from './route-imports.js';
import { registerDevServerSourceMaps } from './dev-source-maps.js';

export type { Config as ReactRouterRsbuildConfig } from './react-router-config.js';
export { loadReactRouterServerBuild } from './dev-generation.js';
export { resolveReactRouterServerBuild };
export type { PluginOptions, ReactRouterRSCPluginOptions } from './types.js';

const MIN_PARALLEL_ENVIRONMENT_BUILD_SPARE_CORES = 4;

type ReactRouterPresetResolvedConfig = Parameters<
  NonNullable<
    NonNullable<Config['presets']>[number]['reactRouterConfigResolved']
  >
>[0]['reactRouterConfig'];

export const shouldParallelizeEnvironmentBuilds = ({
  isBuild,
  spareCoreCount = getDefaultConcurrency(),
}: {
  isBuild: boolean;
  spareCoreCount?: number;
}): boolean =>
  !isBuild && spareCoreCount >= MIN_PARALLEL_ENVIRONMENT_BUILD_SPARE_CORES;

const cssUrlAssetExtensions =
  /\.(?:css|less|sass|scss|styl|stylus|pcss|postcss|sss)$/;
const urlAssetResourceQuery =
  /^(?=.*(?:\?|&)url(?:&|$))(?!.*(?:\?|&)(?:raw|inline)(?:&|$))/;
const javascriptWhitespace = /\s/u;

const hasUseClientDirective = (code: string): boolean => {
  let index = code.charCodeAt(0) === 0xfeff ? 1 : 0;
  if (code.startsWith('#!', index)) {
    const lineEnd = code.indexOf('\n', index + 2);
    if (lineEnd === -1) return false;
    index = lineEnd + 1;
  }

  while (index < code.length) {
    while (
      index < code.length &&
      javascriptWhitespace.test(code.charAt(index))
    ) {
      index += 1;
    }
    if (code.startsWith('//', index)) {
      const lineEnd = code.indexOf('\n', index + 2);
      if (lineEnd === -1) return false;
      index = lineEnd + 1;
      continue;
    }
    if (code.startsWith('/*', index)) {
      const commentEnd = code.indexOf('*/', index + 2);
      if (commentEnd === -1) return false;
      index = commentEnd + 2;
      continue;
    }
    break;
  }

  const quote = code.charAt(index);
  if (quote !== '"' && quote !== "'") return false;
  const directive = `${quote}use client${quote}`;
  if (!code.startsWith(directive, index)) return false;
  index += directive.length;
  while (index < code.length && javascriptWhitespace.test(code.charAt(index))) {
    index += 1;
  }
  return code.charAt(index) === ';';
};

const isRscClientModule = (filePath: string): boolean => {
  try {
    return hasUseClientDirective(readFileSync(filePath, 'utf8'));
  } catch {
    return false;
  }
};

export const pluginReactRouter = (
  options: PluginOptions = {}
): RsbuildPlugin => ({
  name: PLUGIN_NAME,

  async setup(api) {
    const effectRuntime = createPluginEffectRuntime();
    api.onCloseBuild(effectRuntime.dispose);
    api.onCloseDevServer(effectRuntime.dispose);
    api.onExit(effectRuntime.dispose);

    const defaultOptions = {
      customServer: false,
      lazyCompilation: true,
      rsc: false,
      serverOutput: 'module' as const,
    };

    const pluginOptions = {
      ...defaultOptions,
      ...options,
    };
    const isRscMode = Boolean(pluginOptions.rsc);
    const logPerformance = pluginOptions.logPerformance === true;
    const setupStartMs = logPerformance ? performance.now() : 0;
    const performanceProfiler = createReactRouterPerformanceProfiler({
      enabled: logPerformance,
      log: message => api.logger.info(message),
    });
    let assetPrefix = '/';

    // Best-effort configuration validation (upstream: validate-plugin-order).
    // Run during config modification phase so we don't rely on `getRsbuildConfig()`
    // being available during `setup()`.
    api.modifyRsbuildConfig({
      order: 'pre',
      handler(config) {
        const issues = validatePluginOrderFromConfig(config);
        for (const issue of issues) {
          if (issue.kind === 'error') {
            throw new Error(issue.message);
          }
          api.logger.warn(issue.message);
        }
        return config;
      },
    });

    api.onBeforeBuild(() => {
      const normalized = api.getNormalizedConfig();
      warnOnClientSourceMaps(normalized, msg => api.logger.warn(msg), 'web');
    });

    // The manifest / server `publicPath` follows the web environment's asset
    // prefix because that is where the browser assets are served from. A web
    // prefix the server cannot use (`'auto'`) falls back to the root prefix,
    // so `output.assetPrefix: 'https://cdn/'` + web `'auto'` still emits CDN
    // URLs from the server.
    api.onBeforeCreateCompiler(() => {
      const root = api.getNormalizedConfig();
      // `getNormalizedConfig({ environment: 'web' })` throws when the build was
      // narrowed to other environments (`--environment node`), so look the web
      // environment up on the root config instead.
      const web = root.environments.web;
      assetPrefix = resolveEffectiveAssetPrefix(
        {
          dev: web?.dev,
          output: web?.output,
          isBuild: api.context.action === 'build',
        },
        { dev: root.dev, output: root.output }
      );
    });

    const configPath = findEntryFile(resolve('react-router.config'));
    const configExists = existsSync(configPath);
    let configWatchPaths: string | string[] = configExists
      ? configPath
      : JS_EXTENSIONS.map(extension =>
          resolve(`react-router.config${extension}`)
        );
    let reactRouterUserConfig: Config = {};
    if (!configExists) {
      console.warn(
        'No react-router.config found, using default configuration.'
      );
    } else {
      const displayPath = relative(process.cwd(), configPath);
      try {
        const { value: imported, watchPaths } =
          await importConfigWithWatchPaths<Config>(configPath);
        configWatchPaths = watchPaths;
        if (imported === undefined) {
          throw new Error(`${displayPath} must provide a default export`);
        }
        if (typeof imported !== 'object') {
          throw new Error(`${displayPath} must export a config`);
        }
        reactRouterUserConfig = imported;
      } catch (error) {
        throw new Error(`Error loading ${displayPath}: ${error}`);
      }
    }

    const {
      resolved: resolvedConfig,
      presets: configPresets,
      hasConfiguredServerModuleFormat,
    } = await effectRuntime.runPromise(
      resolveReactRouterConfigEffect(reactRouterUserConfig)
    );

    const {
      appDirectory,
      basename,
      buildDirectory,
      future,
      allowedActionOrigins,
      routeDiscovery: userRouteDiscovery,
      ssr,
      prerender: prerenderConfig,
      serverBuildFile,
      serverBundles,
      serverModuleFormat,
      splitRouteModules,
      subResourceIntegrity,
      buildEnd,
    } = resolvedConfig;

    await registerReactRouterTypegen(api, {
      runtime: effectRuntime,
      appDirectory,
    });

    const hasExplicitServerOutput = Object.prototype.hasOwnProperty.call(
      options,
      'serverOutput'
    );
    let resolvedServerOutput = pluginOptions.serverOutput;
    if (!hasExplicitServerOutput) {
      resolvedServerOutput =
        serverModuleFormat === 'cjs' ? 'commonjs' : 'module';
    }

    if (
      hasExplicitServerOutput &&
      hasConfiguredServerModuleFormat &&
      serverModuleFormat &&
      (resolvedServerOutput === 'commonjs' ? 'cjs' : 'esm') !==
        serverModuleFormat
    ) {
      api.logger.warn(
        `[${PLUGIN_NAME}] Both \`serverOutput\` and \`serverModuleFormat\` are set. ` +
          `Using \`serverOutput=${resolvedServerOutput}\` and ignoring ` +
          `\`serverModuleFormat=${serverModuleFormat}\`.`
      );
    }

    if (serverBuildFile && !serverBuildFile.endsWith('.js')) {
      throw new Error('The `serverBuildFile` config must end in `.js`.');
    }

    if (serverModuleFormat !== 'esm' && serverModuleFormat !== 'cjs') {
      throw new Error(
        'The `serverModuleFormat` config must be "esm" or "cjs".'
      );
    }

    const prerenderConfigError = validatePrerenderConfig(prerenderConfig);
    if (prerenderConfigError) {
      throw new Error(prerenderConfigError);
    }

    const routeDiscovery = resolveRouteDiscoveryConfig({
      ssr,
      userRouteDiscovery,
    });

    (globalThis as any).__reactRouterAppDirectory = resolve(appDirectory);
    const routesPath = findEntryFile(resolve(appDirectory, 'routes'));
    if (!existsSync(routesPath)) {
      const missingRoutesPath = relative(
        process.cwd(),
        resolve(appDirectory, 'routes.ts')
      );
      throw new Error(`Route config file not found at "${missingRoutesPath}".`);
    }

    const routeConfigDefine =
      typeof api.getRsbuildConfig === 'function'
        ? api.getRsbuildConfig().source?.define
        : undefined;
    const jiti = createConfigImporter({
      define: routeConfigDefine,
      moduleCache: false,
    });
    const importRouteConfig = async (
      importer: ConfigImporter
    ): Promise<RouteConfigEntry[]> => {
      const routeConfigFile = relative(resolve(appDirectory), routesPath);
      let routeConfigValue: RouteConfigEntry[];
      try {
        const routeConfigExport = await importer.import<RouteConfigEntry[]>(
          routesPath,
          {
            default: true,
          }
        );
        routeConfigValue = await routeConfigExport;
      } catch (error) {
        // Match upstream: import/evaluation failures (e.g. syntax errors) are
        // reported as an invalid route config rather than a raw loader error.
        throw new Error(
          [
            `Route config in "${routeConfigFile}" is invalid.`,
            '',
            error instanceof Error
              ? (error.stack ?? error.message)
              : String(error),
          ].join('\n')
        );
      }
      const validation = validateRouteConfig({
        routeConfigFile,
        routeConfig: routeConfigValue,
      });
      if (!validation.valid) {
        throw new Error(validation.message);
      }
      return validation.routeConfig;
    };
    const loadRouteConfig = () => importRouteConfig(jiti);
    const { value: routeConfig, watchPaths: routeConfigWatchPaths } =
      await importConfigWithWatchPaths(routesPath, importRouteConfig, {
        define: routeConfigDefine,
      });

    const {
      devServerBuildEntryName,
      finalEntryClientPath,
      finalEntryRscClientPath,
      finalEntryRscPath,
      finalEntryRscSsrPath,
      finalEntryServerPath,
      hasServerApp,
      serverAppPath,
    } = resolveReactRouterEntryPaths({
      appDirectory,
      templatesDirectory: resolve(__dirname, 'templates'),
    });

    if (isRscMode) {
      assertReactRouterRscSupport({
        pluginName: PLUGIN_NAME,
        resolvePackagePath: resolveAppPackagePath,
      });
      assertReactRouterRscConfigSupport({
        pluginName: PLUGIN_NAME,
        userConfig: resolvedConfig,
      });
      await setupReactRouterRscPlugin({
        api,
        entryRscPath: finalEntryRscPath,
        entrySsrPath: finalEntryRscSsrPath,
        pluginName: PLUGIN_NAME,
        rsc: typeof pluginOptions.rsc === 'object' ? pluginOptions.rsc : {},
      });
    }

    const getRootRoutePath = () => findEntryFile(resolve(appDirectory, 'root'));
    const rootRoutePath = getRootRoutePath();
    // React Router's server build expects route files relative to `appDirectory`
    // so it can resolve them correctly during compilation.
    const rootRouteFile = relative(appDirectory, rootRoutePath);
    const routeTopology = createReactRouterRouteTopology({
      appDirectory,
      rootRouteFile,
      routeConfig,
      loadRouteConfig,
      getRootRoutePath,
    });

    const routes = {
      root: { path: '', id: 'root', file: rootRouteFile },
      ...configRoutesToRouteManifest(appDirectory, routeConfig),
    };

    const resolvedConfigWithRoutes: ResolvedReactRouterConfig = {
      appDirectory: resolve(appDirectory),
      basename,
      buildDirectory: resolve(buildDirectory),
      buildEnd,
      future,
      prerender: prerenderConfig,
      routes,
      routeDiscovery,
      serverBuildFile,
      serverBundles,
      serverModuleFormat,
      ssr,
      splitRouteModules,
      subResourceIntegrity,
      allowedActionOrigins: allowedActionOrigins ?? false,
      unstable_routeConfig: routeConfig,
    };

    const { buildEnd: _buildEnd, ...resolvedConfigForPreset } =
      resolvedConfigWithRoutes;
    for (const preset of configPresets) {
      await preset.reactRouterConfigResolved?.({
        reactRouterConfig:
          resolvedConfigForPreset as ReactRouterPresetResolvedConfig,
      });
    }
    const buildEndReactRouterConfig = resolvedConfigWithRoutes;

    const isBuild = api.context.action === 'build';
    if (!isBuild) {
      api.onAfterEnvironmentCompile(({ environment, stats }) => {
        if (environment.name === 'node' && stats && !stats.hasErrors()) {
          registerDevServerSourceMaps(stats.compilation);
        }
      });
    }
    const shouldDependOnWebCompiler = !shouldParallelizeEnvironmentBuilds({
      isBuild,
    });
    const isPrerenderEnabled =
      prerenderConfig !== undefined && prerenderConfig !== false;
    const isSpaMode = !ssr && !isPrerenderEnabled;
    const routeCount = Object.keys(routes).length;
    const routeChunkCache: RouteChunkCache = new Map();
    const useRouteModuleTransformLoader =
      !isRscMode &&
      shouldUseRouteModuleTransformLoader(pluginOptions.parallelRouteTransform);
    const routeTransformRunner: RouteTransformRunner = task =>
      executeRouteTransformTask(task, { routeChunkCache });
    const transformedRouteModuleAnalyses = new Map<
      string,
      RouteModuleAnalysis
    >();
    const rememberRouteModuleAnalysis = (
      resourcePath: string,
      analysis: RouteModuleAnalysis
    ) => {
      transformedRouteModuleAnalyses.set(resolve(resourcePath), analysis);
    };
    const routeModuleAnalysis = async (routeFilePath: string) =>
      transformedRouteModuleAnalyses.get(resolve(routeFilePath));
    const outputClientPath = resolve(buildDirectory, 'client');
    const assetsBuildDirectory = relative(process.cwd(), outputClientPath);
    const watchDirectory = resolve(appDirectory);
    const routeRestartMarkerPath = getRouteRestartMarkerPath(appDirectory);
    const routeWatchFiles = createReactRouterRouteWatchFiles({
      configWatchPaths,
      routeConfigWatchPaths,
      routeRestartMarkerPath,
      onRouteTopologyChange: pluginOptions.onRouteTopologyChange,
    });
    let latestBrowserManifest: ReactRouterManifest | null = null;
    let latestBrowserManifestModuleExports: RouteManifestModuleExports = {};
    let latestServerManifest: ReactRouterManifest | null = null;
    const latestServerManifestsByBundleId: Record<string, ReactRouterManifest> =
      {};

    const routeByFilePath = new Map(
      Object.values(routes).map(route => [
        resolve(appDirectory, route.file),
        route,
      ])
    );
    const allowedActionOriginsForBuild =
      allowedActionOrigins === false ? undefined : allowedActionOrigins;

    const devHmrRefreshRuntimePath =
      isBuild || isRscMode
        ? undefined
        : resolveReactRefreshRuntimePath(api.context.rootPath);
    const devHdrSignal = devHmrRefreshRuntimePath
      ? createDevHdrRevisionSignal({
          filePath: getDevHdrRevisionFilePath(api.context.rootPath),
          onError: error =>
            api.logger.debug(
              `[${PLUGIN_NAME}] Failed to signal hot data revalidation: ${error.message}`
            ),
        })
      : undefined;
    let devHmrEnabled = false;
    if (devHmrRefreshRuntimePath && devHdrSignal) {
      api.modifyEnvironmentConfig(
        async (environmentConfig, { name, mergeEnvironmentConfig }) => {
          if (name !== 'web') return environmentConfig;
          return mergeEnvironmentConfig(environmentConfig, {
            tools: {
              rspack: rspackConfig => {
                devHmrEnabled = isRspackSwcReactRefreshEnabled(rspackConfig);
                if (devHmrEnabled) devHdrSignal.ensure();
                return rspackConfig;
              },
            },
          });
        }
      );
    }

    const commonModeOptions = {
      api,
      allowedActionOriginsForBuild,
      appDirectory,
      basename,
      customServer: pluginOptions.customServer,
      isBuild,
      isSpaMode,
      prerenderConfig,
      routeConfig,
      routeDiscovery,
      routes,
      rootRouteFile,
      splitRouteModules,
      ssr,
    };
    const modePlan = await (isRscMode
      ? createReactRouterModePlan({
          ...commonModeOptions,
          isRscMode: true,
          buildDirectory,
          finalEntryRscClientPath,
          finalEntryRscPath,
          finalEntryRscSsrPath,
          outputClientPath,
          pluginName: PLUGIN_NAME,
          serverBuildFile,
        })
      : createReactRouterModePlan({
          ...commonModeOptions,
          isRscMode: false,
          assetsBuildDirectory,
          defaultEntryName: devServerBuildEntryName,
          entryServerPath: finalEntryServerPath,
          finalEntryClientPath,
          future,
          hasServerApp,
          reactRouterConfig: resolvedConfigWithRoutes,
          routeChunkCache,
          serverAppPath,
          shouldDependOnWebCompiler,
          devHmr:
            devHmrRefreshRuntimePath && devHdrSignal
              ? {
                  isEnabled: () => devHmrEnabled,
                  runtimeModule: generateDevHmrRuntimeModule({
                    reactRefreshRuntimePath: devHmrRefreshRuntimePath,
                    hdrRevisionFilePath: devHdrSignal.filePath,
                  }),
                  onNodeRebuildCommitted: () => {
                    if (devHmrEnabled) devHdrSignal.bump();
                  },
                }
              : undefined,
        }));

    const { manifestChunkNames } = modePlan;

    let sendRscDevUpdate: (() => void) | undefined;
    let scheduledRscDevUpdate: ReturnType<typeof setTimeout> | undefined;
    let hasPendingRscNodeUpdate = false;
    let pendingRscNodeFiles = new Set<string>();
    if (isRscMode && !isBuild) {
      api.onBeforeStartDevServer(({ server }) => {
        sendRscDevUpdate = () =>
          server.sockWrite('custom', {
            event: 'rsc:update',
            data: { revalidate: true },
          });
      });
      api.onCloseDevServer(() => {
        if (scheduledRscDevUpdate) {
          clearTimeout(scheduledRscDevUpdate);
          scheduledRscDevUpdate = undefined;
        }
        hasPendingRscNodeUpdate = false;
        pendingRscNodeFiles.clear();
        sendRscDevUpdate = undefined;
      });
      api.onAfterEnvironmentCompile(({ environment, stats }) => {
        if (
          (environment.name !== 'node' && environment.name !== 'web') ||
          stats?.hasErrors()
        ) {
          return;
        }
        if (environment.name === 'node') {
          const compiler = stats?.compilation.compiler;
          const changedFiles = new Set([
            ...(compiler?.modifiedFiles ?? []),
            ...(compiler?.removedFiles ?? []),
          ]);
          // Initial and lazy compilations do not represent source edits. Sending
          // an RSC revalidation for them can race and abort the navigation that
          // requested the lazy module.
          if (changedFiles.size === 0) {
            return;
          }
          hasPendingRscNodeUpdate = true;
          pendingRscNodeFiles = changedFiles;
        }
        if (!hasPendingRscNodeUpdate) {
          return;
        }
        if (scheduledRscDevUpdate) {
          clearTimeout(scheduledRscDevUpdate);
        }
        scheduledRscDevUpdate = setTimeout(() => {
          scheduledRscDevUpdate = undefined;
          hasPendingRscNodeUpdate = false;
          const clientHotUpdateHandlesChange =
            pendingRscNodeFiles.size > 0 &&
            [...pendingRscNodeFiles].every(isRscClientModule);
          const routeHotUpdateHandlesChange = [...pendingRscNodeFiles].some(
            filePath => routeByFilePath.has(resolve(filePath))
          );
          pendingRscNodeFiles.clear();
          if (!clientHotUpdateHandlesChange && !routeHotUpdateHandlesChange) {
            sendRscDevUpdate?.();
          }
        }, 1000);
      });
    }

    const devBackgroundResources =
      await registerReactRouterDevBackgroundResources({
        api,
        runtime: effectRuntime,
        isBuild,
        lazyCompilationPrewarm: pluginOptions.unstableLazyCompilationPrewarm,
        routeRestartMarkerPath,
        watchDirectory,
        getRouteTopology: routeTopology.getRouteTopology,
        initialRouteTopology: routeTopology.initialRouteTopology,
        onRouteTopologyChange: pluginOptions.onRouteTopologyChange,
      });

    const stageLatestManifests = (
      manifest: ReactRouterManifest,
      sri: ReactRouterManifest['sri'],
      moduleExportsByRouteId: RouteManifestModuleExports,
      compilation: Rspack.Compilation
    ) => {
      performanceProfiler.recordSync(
        'web',
        'manifest:stage',
        'virtual/react-router/browser-manifest',
        () => {
          latestBrowserManifest = manifest;
          devBackgroundResources.setManifest(manifest);
          latestBrowserManifestModuleExports = moduleExportsByRouteId;
          const baseServerManifest = {
            ...manifest,
            sri,
          };
          latestServerManifest = baseServerManifest;
          const manifestsByEntryName: Record<string, ReactRouterManifest> = {
            [devServerBuildEntryName]: baseServerManifest,
          };

          if (modePlan.kind !== 'classic') {
            return;
          }

          for (const { bundleId, entryName } of modePlan.artifacts
            .serverBundleEntries) {
            const bundleRoutes =
              modePlan.artifacts.routesByServerBundleId[bundleId];
            if (!bundleRoutes) {
              continue;
            }

            const routeIds = new Set(Object.keys(bundleRoutes));
            const filteredRoutes = Object.fromEntries(
              Object.entries(manifest.routes).filter(([routeId]) =>
                routeIds.has(routeId)
              )
            );
            const bundleManifest = {
              ...baseServerManifest,
              routes: filteredRoutes,
            };
            latestServerManifestsByBundleId[bundleId] = bundleManifest;
            manifestsByEntryName[entryName] = bundleManifest;
          }

          if (!isBuild) {
            modePlan.artifacts.devRuntime.captureWeb(
              compilation,
              manifestsByEntryName
            );
          }
        }
      );
    };

    let clientStats: ReactRouterManifestStats | undefined;
    api.onAfterEnvironmentCompile(({ stats, environment }) => {
      if (environment.name === 'web') {
        clientStats = createReactRouterManifestStats(
          stats?.compilation,
          manifestChunkNames
        );
        if (isRscMode && stats) {
          // Rspack's RSC manifest only records browser scripts whose emitted
          // name ends in ".js" (entry files and client-reference chunks
          // alike); anything else silently disappears from `entryJsFiles` and
          // the client manifest, and the server cannot bootstrap or preload
          // it. Check the emitted output, which is what the manifest saw, so
          // function filenames and `tools.rspack` overrides are covered too.
          const unsupported = collectUnsupportedRscScriptAssets(
            stats.compilation
          );
          if (unsupported.length > 0) {
            throw new Error(
              `[${PLUGIN_NAME}] RSC mode requires every browser JavaScript asset to be named "*.js" (no query, no other extension): rspack's RSC manifest omits ${unsupported
                .slice(0, 5)
                .map(asset => JSON.stringify(asset))
                .join(
                  ', '
                )}${unsupported.length > 5 ? ` and ${unsupported.length - 5} more` : ''}. Adjust web \`output.filename.js\` / \`chunkFilename\`.`
            );
          }
        }
      }
      if (pluginOptions.federation && ssr) {
        const serverBuildDir = resolve(buildDirectory, 'server');
        const clientBuildDir = resolve(buildDirectory, 'client');
        if (existsSync(serverBuildDir)) {
          const ssrDir = resolve(clientBuildDir, 'static');
          fsExtra.copySync(serverBuildDir, ssrDir);
        }
      }
      if (logPerformance) {
        performanceProfiler.flush(environment.name, {
          compilerLifecycleMs: roundMs(performance.now() - setupStartMs),
        });
      }
    });

    if (modePlan.kind === 'classic') {
      api.onAfterBuild(({ environments }) =>
        effectRuntime.runPromise(
          tryPluginPromise(() =>
            runReactRouterPrerenderBuild({
              api,
              hasWebEnvironment: Boolean(environments.web),
              buildDirectory,
              serverBuildFile,
              ssr,
              isPrerenderEnabled,
              prerenderConfig,
              prerenderPaths: modePlan.artifacts.prerenderPaths,
              basename,
              future,
              routes,
              latestBrowserManifest,
              latestBrowserManifestModuleExports,
              clientStats,
              pluginOptions,
              appDirectory,
              assetPrefix,
              routeChunkOptions: modePlan.routeChunkOptions,
              routeModuleAnalysis,
              buildManifest: modePlan.artifacts.buildManifest,
              buildEndReactRouterConfig,
              buildEnd,
            })
          )
        )
      );
    } else {
      api.onAfterBuild(({ environments }) =>
        effectRuntime.runPromise(
          tryPluginPromise(() =>
            runReactRouterRscPrerenderBuild({
              api,
              hasWebEnvironment: Boolean(environments.web),
              buildDirectory,
              serverBuildFile,
              ssr,
              prerenderConfig,
              prerenderPaths: modePlan.prerenderPaths,
              basename,
            })
          )
        )
      );
    }

    // Public requests stay bare while Rspack resolves seeded virtual files.
    const createVirtualModulePlugin = (publicPath: string) => {
      return new rspack.experiments.VirtualModulesPlugin(
        mapVirtualModules(modePlan.createVirtualModules(publicPath))
      );
    };

    api.modifyRsbuildConfig(async (config, { mergeRsbuildConfig }) => {
      const webConfig = config.environments?.web;
      const assetPrefix = resolveEffectiveAssetPrefix(
        { dev: webConfig?.dev, output: webConfig?.output, isBuild },
        { dev: config.dev, output: config.output }
      );
      const vmodPlugin = createVirtualModulePlugin(assetPrefix);
      const configuredLazyCompilation = Object.prototype.hasOwnProperty.call(
        options,
        'lazyCompilation'
      )
        ? pluginOptions.lazyCompilation
        : (config.dev?.lazyCompilation ?? pluginOptions.lazyCompilation);
      const guardedLazyCompilation = guardReactRouterLazyCompilation({
        lazyCompilation: configuredLazyCompilation,
        entryClientPath: isRscMode
          ? finalEntryRscClientPath
          : finalEntryClientPath,
        prewarmReactRouterModules: Boolean(
          pluginOptions.unstableLazyCompilationPrewarm
        ),
      });
      const lazyCompilation =
        guardedLazyCompilation === undefined
          ? {}
          : { lazyCompilation: guardedLazyCompilation };
      const shouldCompactFileSizeReport =
        isBuild &&
        routeCount >= 256 &&
        (config.performance?.printFileSize === undefined ||
          config.performance.printFileSize === true);
      const resolveConfig = modePlan.createResolveConfig(api.context.rootPath);

      // Browser code (React itself) reads `process.env.NODE_ENV`. Rsbuild only
      // emits the define for its recognized modes; an unrecognized NODE_ENV
      // (e.g. the string "undefined" leaking from a misconfigured shell)
      // resolves mode 'none' and leaves the bare reference in the web bundle,
      // which throws `process is not defined` at runtime. Always define it for
      // the web environment — mirroring the Vite plugin — unless the user
      // supplies their own define.
      const userDefinesNodeEnv =
        config.source?.define?.['process.env.NODE_ENV'] !== undefined ||
        config.environments?.web?.source?.define?.['process.env.NODE_ENV'] !==
          undefined;
      const webNodeEnv =
        process.env.NODE_ENV === 'production' ||
        process.env.NODE_ENV === 'development' ||
        process.env.NODE_ENV === 'test'
          ? process.env.NODE_ENV
          : isBuild
            ? 'production'
            : 'development';

      return mergeRsbuildConfig(config, {
        ...(shouldCompactFileSizeReport
          ? {
              performance: {
                printFileSize: {
                  total: true,
                  detail: false,
                  compressed: false,
                },
              },
            }
          : {}),
        output: {
          assetPrefix: config.output?.assetPrefix || '/',
        },
        server: modePlan.server,
        dev: {
          ...lazyCompilation,
          watchFiles: mergeWatchFiles(config.dev?.watchFiles, routeWatchFiles),
        },
        tools: {
          rspack: {
            resolve: resolveConfig,
            plugins: [
              vmodPlugin,
              createQuerylessRouteImportPlugin(routeByFilePath, {
                rsc: isRscMode,
              }),
            ],
          },
        },
        environments: {
          web: {
            ...(resolvedConfigWithRoutes.subResourceIntegrity
              ? {
                  security: {
                    sri: {
                      enable: true,
                    },
                  },
                }
              : {}),
            source: {
              entry: modePlan.webEntries,
              ...(userDefinesNodeEnv
                ? {}
                : {
                    define: {
                      'process.env.NODE_ENV': JSON.stringify(webNodeEnv),
                    },
                  }),
            },
            output: {
              distPath: {
                root: outputClientPath,
              },
            },
            tools: {
              rspack: {
                resolve: resolveConfig,
                name: 'web',
                module: {
                  rules: [
                    {
                      resourceQuery: urlAssetResourceQuery,
                      exclude: cssUrlAssetExtensions,
                      type: 'asset/resource',
                    },
                  ],
                },
                externalsType: modePlan.webExternalsType,
                optimization: modePlan.webOptimization,
              },
            },
          },
          // Always include node environment, even for SPA mode (`ssr:false`),
          // because React Router still needs a server build to prerender the
          // root route into a hydratable `index.html` at build time.
          node: {
            source: {
              entry: modePlan.nodeEntries,
            },
            output: {
              distPath: {
                root: resolve(buildDirectory, 'server'),
              },
              target: config.environments?.node?.output?.target || 'node',
              filename: {
                js: '[name].js',
                css: (pathData: Rspack.PathData) => {
                  const sourceName = pathData.chunk?.name ?? '[name]';
                  if (!isBuild) {
                    return `${sourceName}.css`;
                  }
                  const baseName =
                    sourceName.split(/[\\/]/).pop() || sourceName;
                  return `../assets/${baseName}.[contenthash:10].css`;
                },
              },
            },
            tools: {
              rspack: {
                target: options.federation ? 'async-node' : 'node',
                module: {
                  rules: [
                    {
                      resourceQuery: urlAssetResourceQuery,
                      exclude: cssUrlAssetExtensions,
                      type: 'asset/resource',
                    },
                  ],
                },
                externals: modePlan.nodeExternals,
                ...modePlan.nodeDependencies,
                externalsType: resolvedServerOutput,
              },
            },
          },
        },
      });
    });

    registerReactRouterEnvironmentOutput({
      api,
      federation: pluginOptions.federation,
      resolvedServerOutput,
      webOutput: modePlan.webOutput,
    });

    if (pluginOptions.federation && modePlan.kind === 'classic') {
      // Module Federation's async startup makes every entry's startup a
      // promise. React Router imports each browser route-module entry
      // synchronously (`import * as route0 from ".../root.js"`) and reads its
      // exports right away, and `import()`s split route chunks the same way.
      // Making those entry modules async (top-level await) turns Rspack's
      // module-library export into `(await startup).default`, so importers
      // wait for the awaited startup instead of reading a snapshot of the
      // promise (#132). Runs after SWC so it applies to the final module code.
      const browserEntryModules = new Set([
        finalEntryClientPath,
        ...routeByFilePath.keys(),
      ]);
      api.transform(
        {
          environments: ['web'],
          order: 'post',
          test: (resourcePath: string) => browserEntryModules.has(resourcePath),
        },
        // `export {}` keeps an otherwise-empty client module (a route with only
        // server exports) parsed as ESM, which top-level await requires.
        ({ code }) => `${code}\nexport {};\nawait Promise.resolve();\n`
      );
    }

    if (modePlan.kind === 'classic' && useRouteModuleTransformLoader) {
      api.modifyEnvironmentConfig(
        async (config, { name, mergeEnvironmentConfig }) => {
          if (name !== 'web' && name !== 'node') {
            return config;
          }

          return mergeEnvironmentConfig(config, {
            tools: {
              rspack: rspackConfig => {
                const environmentDevHmrEnabled =
                  name === 'web' &&
                  !isBuild &&
                  devHmrRefreshRuntimePath !== undefined &&
                  config.mode === 'development' &&
                  config.dev?.hmr !== false &&
                  isRspackSwcReactRefreshEnabled(rspackConfig);

                registerRouteModuleTransformRules(rspackConfig, {
                  environmentName: name,
                  ssr,
                  isBuild,
                  isSpaMode,
                  rootRoutePath,
                  devHmr: environmentDevHmrEnabled,
                  logPerformance,
                  routeByFilePath,
                  parallelRouteTransform: pluginOptions.parallelRouteTransform,
                });
                return rspackConfig;
              },
            },
          });
        }
      );
    }

    if (modePlan.kind === 'rsc') {
      registerReactRouterRscRouteTransforms({
        api,
        isBuild,
        performanceProfiler,
        routeByFilePath,
        routeChunkCache,
        routeChunkConfig: modePlan.routeChunkConfig,
      });

      // RSC mode has no `registerBuildOutputTransforms` pass, so relocate the
      // node-emitted `?url`/`.css?url` static assets into the client build here.
      // Without this the href baked into `links()` (resolved in the node env)
      // 404s in the browser because the file only exists under `build/server`.
      registerSsrAssetRelocation({
        api,
        outputClientPath,
        performanceProfiler,
      });
    } else {
      registerModifyBrowserManifestAssets(
        api,
        routes,
        pluginOptions,
        appDirectory,
        () => assetPrefix,
        modePlan.routeChunkOptions,
        {
          subResourceIntegrity: resolvedConfigWithRoutes.subResourceIntegrity,
          future,
          manifestChunkNames,
          routeModuleAnalysis,
          onManifest: (manifest, sri, moduleExportsByRouteId, context) =>
            stageLatestManifests(
              manifest,
              sri,
              moduleExportsByRouteId,
              context.compilation
            ),
        }
      );

      registerBuildOutputTransforms({
        api,
        resolvedServerOutput,
        performanceProfiler,
        getLatestServerManifest: () => latestServerManifest,
        getLatestServerManifestByBundleId: bundleId =>
          latestServerManifestsByBundleId[bundleId],
        routes,
        pluginOptions,
        getClientStats: () => clientStats,
        appDirectory,
        getAssetPrefix: () => assetPrefix,
        routeChunkOptions: modePlan.routeChunkOptions,
        routeModuleAnalysis,
        routeTransformRunner,
        routeByFilePath,
        routeChunkConfig: modePlan.routeChunkConfig,
        isBuild,
        splitRouteModules: Boolean(modePlan.routeChunkConfig.splitRouteModules),
        useRouteModuleTransformApi: !useRouteModuleTransformLoader,
        ssr,
        isSpaMode,
        rootRoutePath,
        outputClientPath,
        isDevHmrEnabled: () => devHmrEnabled,
        onRouteModuleAnalysis: rememberRouteModuleAnalysis,
      });
    }
  },
});

export const pluginReactRouterRSC = (
  options: ReactRouterRSCPluginOptions = {}
): RsbuildPlugin =>
  pluginReactRouter({
    ...options,
    rsc: options.rsc ?? true,
  });
