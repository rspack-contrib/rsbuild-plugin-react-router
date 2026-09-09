import * as fs from 'node:fs';
import { afterEach, rstest } from '@rstest/core';

type ReactRouterTestGlobal = typeof globalThis & {
  __reactRouterTestConfig?: unknown;
  __reactRouterTestJitiCache?: Record<string, unknown>;
  __reactRouterTestJitiCacheAfterImport?: Record<string, unknown>;
};

const testGlobal = globalThis as ReactRouterTestGlobal;

afterEach(() => {
  delete testGlobal.__reactRouterTestConfig;
  delete testGlobal.__reactRouterTestJitiCache;
  delete testGlobal.__reactRouterTestJitiCacheAfterImport;
});

// Mock the file system
rstest.mock('node:fs', { spy: true });
rstest.spyOn(fs, 'existsSync').mockReturnValue(true);

// Mock jiti
rstest.mock('jiti', () => ({
  createJiti: (_cwd: string, options?: { moduleCache?: boolean }) => {
    const useSharedCache = options?.moduleCache !== false;
    const cache = useSharedCache
      ? (testGlobal.__reactRouterTestJitiCache ?? {})
      : {};

    return {
      cache,
      import: rstest.fn().mockImplementation((path) => {
        const cacheAfterImport = testGlobal.__reactRouterTestJitiCacheAfterImport;
        if (useSharedCache && cacheAfterImport) {
          Object.assign(cache, cacheAfterImport);
        }

        if (path.includes('routes.ts')) {
          const routeCount = Number(process.env.RR_TEST_ROUTE_COUNT ?? 0);
          if (routeCount > 0) {
            const childRouteCount = Math.max(0, routeCount - 1);
            return Promise.resolve(
              Array.from({ length: childRouteCount }, (_, index) => ({
                id: `routes/route-${index}`,
                file: `routes/route-${index}.tsx`,
                index: index === 0,
              }))
            );
          }
          return Promise.resolve([
            {
              id: 'routes/index',
              file: 'routes/index.tsx',
              index: true,
            },
          ]);
        }
        if (process.env.RR_TEST_SPLIT_ROUTE_MODULES === 'true') {
          return Promise.resolve({
            ...(testGlobal.__reactRouterTestConfig as object | undefined),
            splitRouteModules: true,
          });
        }
        return Promise.resolve(
          testGlobal.__reactRouterTestConfig ?? {}
        );
      }),
    };
  },
}));

// Mock webpack sources
const mockRawSource = rstest.fn().mockImplementation((content) => ({
  source: () => content,
  size: () => content.length,
}));

const deepMerge = (base: any, overrides: any): any => {
  if (!overrides || typeof overrides !== 'object') {
    return base;
  }
  // Like `mergeRsbuildConfig` for `tools.*`: a function merged with an object
  // becomes an ordered list that Rsbuild later applies in sequence.
  if (typeof base === 'function') {
    return [base, overrides];
  }
  if (Array.isArray(base) && !Array.isArray(overrides)) {
    return [...base, overrides];
  }
  if (!base || typeof base !== 'object') {
    return overrides;
  }
  const result: Record<string, any> = Array.isArray(base) ? [...base] : { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    if (Array.isArray(value)) {
      result[key] = value.slice();
    } else if (value && typeof value === 'object') {
      result[key] = deepMerge(result[key], value);
    } else {
      result[key] = value;
    }
  }
  return result;
};

// Mock the @scripts/test-helper module
rstest.mock('@scripts/test-helper', () => ({
  createStubRsbuild: rstest.fn().mockImplementation(async ({ action = 'dev', rsbuildConfig = {} } = {}) => {
    const baseConfig = {
      dev: {
        // Match Rsbuild defaults so plugin changes are observable in tests.
        // (Historically the plugin forced `hmr: false` / `liveReload: true`.)
        hmr: true,
        liveReload: true,
        writeToDisk: false,
      },
      environments: {
        web: {
          tools: {
            rspack: {
              experiments: { outputModule: true },
              externalsType: 'module',
              output: {
                chunkFormat: 'module',
                module: true,
              },
            },
          },
        },
        node: {
          tools: {
            rspack: {
              externals: ['express'],
              experiments: { outputModule: true },
              output: {
                chunkFormat: 'commonjs',
                chunkLoading: 'require',
                module: false,
              },
            },
          },
        },
      },
      tools: {
        rspack: {
          plugins: [
            { constructor: { name: 'VirtualModulesPlugin' } },
          ],
        },
      },
      transforms: [
        { resourceQuery: /react-router-route/ },
      ],
    };

    let mergedConfig = deepMerge(baseConfig, rsbuildConfig);

    const mergeRsbuildConfig = (a: any, b: any) => deepMerge(a, b);
    const pending: Promise<unknown>[] = [];
    const stub: any = {
      addPlugins: rstest.fn(),
      unwrapConfig: rstest.fn(),
      processAssets: rstest.fn(),
      onBeforeStartDevServer: rstest.fn(),
      onAfterStartDevServer: rstest.fn(),
      onCloseDevServer: rstest.fn(),
      onCloseBuild: rstest.fn(),
      onExit: rstest.fn(),
      onBeforeBuild: rstest.fn(),
      onAfterBuild: rstest.fn(),
      onBeforeDevCompile: rstest.fn(),
      onAfterDevCompile: rstest.fn(),
      onBeforeCreateCompiler: rstest.fn(),
      onAfterCreateCompiler: rstest.fn(),
      getNormalizedConfig: rstest.fn().mockImplementation(() => mergedConfig),
      isPluginExists: rstest.fn().mockReturnValue(false),
      modifyRsbuildConfig: rstest.fn(),
      modifyRspackConfig: rstest.fn(),
      modifyBundlerChain: rstest.fn(),
      onAfterEnvironmentCompile: rstest.fn(),
      // Keep as a spy-only hook; tests in this repo assert against the merged
      // Rsbuild config (modifyRsbuildConfig), not post-normalization environment
      // mutations.
      modifyEnvironmentConfig: rstest.fn(),
      transform: rstest.fn(),
      logger: {
        warn: rstest.fn(),
        info: rstest.fn(),
        error: rstest.fn(),
      },
      context: {
        rootPath: '/Users/bytedance/dev/rsbuild-plugin-react-router',
        action,
      },
      compiler: {
        webpack: {
          sources: {
            RawSource: mockRawSource,
          },
        },
      },
    };

    stub.modifyRsbuildConfig.mockImplementation((arg: any) => {
      const handler = typeof arg === 'function' ? arg : arg?.handler;
      if (typeof handler !== 'function') return;

      const res = handler(mergedConfig, { mergeRsbuildConfig });
      if (res && typeof res.then === 'function') {
        const p = res.then((next: any) => {
          if (next) mergedConfig = next;
          return next;
        });
        pending.push(p);
        return p;
      }
      if (res) mergedConfig = res;
      return res;
    });

    // In Rsbuild, `addPlugins()` triggers plugin setup before config is read.
    const flattenPlugins = (plugins: any[]): any[] =>
      plugins.flatMap(plugin => (Array.isArray(plugin) ? flattenPlugins(plugin) : plugin));

    stub.addPlugins.mockImplementation((next: any[]) => {
      for (const plugin of flattenPlugins(next)) {
        if (typeof plugin?.setup === 'function') {
          // Tests do not await `addPlugins`, so ensure `unwrapConfig` waits for setup.
          pending.push(Promise.resolve(plugin.setup(stub)));
        }
      }
    });

    stub.unwrapConfig.mockImplementation(async () => {
      await Promise.all(pending);
      return mergedConfig;
    });

    // Apply the recorded `modifyRspackConfig` handlers for one environment and
    // return the resulting Rspack config, mirroring Rsbuild's hook order (the
    // handlers run before the user's `tools.rspack`, which is applied last).
    const rspackHandlers: any[] = [];
    stub.modifyRspackConfig.mockImplementation((handler: any) => {
      rspackHandlers.push(handler);
    });
    stub.unwrapRspackConfig = rstest.fn().mockImplementation(
      async (environmentName: string, initial: any = {}) => {
        await Promise.all(pending);
        let current = initial;
        const utils = {
          environment: { name: environmentName },
          mergeConfig: (a: any, b: any) => deepMerge(a, b),
        };
        for (const handler of rspackHandlers) {
          current = (await handler(current, utils)) ?? current;
        }
        const toolsRspack = mergedConfig.environments?.[environmentName]?.tools?.rspack;
        for (const entry of [toolsRspack].flat()) {
          if (typeof entry === 'function') {
            current = (await entry(current, utils)) ?? current;
          } else if (entry) {
            current = deepMerge(current, entry);
          }
        }
        return current;
      }
    );

    return stub;
  }),
})); 
