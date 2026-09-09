import { createStubRsbuild } from '@scripts/test-helper';
import { describe, expect, it, rstest } from '@rstest/core';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  pluginReactRouter,
  pluginReactRouterRSC,
  shouldParallelizeEnvironmentBuilds,
} from '../src';

type ReactRouterTestGlobal = typeof globalThis & {
  __reactRouterTestConfig?: unknown;
  __reactRouterTestJitiCache?: Record<string, unknown>;
  __reactRouterTestJitiCacheAfterImport?: Record<string, unknown>;
};

const testGlobal = globalThis as ReactRouterTestGlobal;

type LazyCompilationTestModule = {
  resource?: string;
  nameForCondition?: () => string | null;
};

type LazyCompilationConfig = {
  test?: (module: LazyCompilationTestModule) => boolean;
};

const getLazyCompilationTest = (
  lazyCompilation: boolean | LazyCompilationConfig | undefined
) => {
  if (
    !lazyCompilation ||
    typeof lazyCompilation === 'boolean' ||
    typeof lazyCompilation.test !== 'function'
  ) {
    throw new Error('Expected lazy compilation to install a test function.');
  }
  return lazyCompilation.test;
};

const requireFromHere = createRequire(import.meta.url);

const captureEnv = (keys: string[]) => {
  const previousValues = new Map(
    keys.map(key => [key, process.env[key]] as const)
  );
  return () => {
    for (const [key, value] of previousValues) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
};

describe('pluginReactRouter', () => {
  it('should configure basic plugin options', async () => {
    const rsbuild = await createStubRsbuild({
      rsbuildConfig: {},
    });

    rsbuild.addPlugins([pluginReactRouter()]);
    const config = await rsbuild.unwrapConfig();

    // The plugin should not override Rsbuild's HMR defaults.
    expect(config.dev.hmr).toBe(true);
    expect(config.dev.liveReload).toBe(true);
    expect(config.dev.writeToDisk).toBe(false);
    expect(config.dev.lazyCompilation).toMatchObject({
      entries: true,
      imports: true,
    });
    expect(
      config.dev.lazyCompilation.test({
        resource: `${process.cwd()}/app/entry.client.tsx`,
      })
    ).toBe(false);
  });

  it('aliases React Router packages to the app install', async () => {
    const rsbuild = await createStubRsbuild({
      rsbuildConfig: {},
    });

    rsbuild.addPlugins([pluginReactRouter()]);
    const config = await rsbuild.unwrapConfig();

    expect(config.tools.rspack.resolve.alias).toMatchObject({
      'react-router$': requireFromHere.resolve('react-router'),
      'react-router/dom$': requireFromHere.resolve('react-router/dom'),
    });
  });

  it('preserves an explicit writeToDisk override', async () => {
    const rsbuild = await createStubRsbuild({
      rsbuildConfig: {
        dev: { writeToDisk: true },
      },
    });

    rsbuild.addPlugins([pluginReactRouter()]);
    const config = await rsbuild.unwrapConfig();

    expect(config.dev.writeToDisk).toBe(true);
  });

  it('adds the committed custom-server build entry only in development', async () => {
    const devRsbuild = await createStubRsbuild({ rsbuildConfig: {} });
    devRsbuild.addPlugins([pluginReactRouter({ customServer: true })]);
    const devConfig = await devRsbuild.unwrapConfig();

    expect(
      devConfig.environments.node.source.entry[
        'static/js/react-router-server-build'
      ]
    ).toBe('virtual/react-router/server-build');

    const buildRsbuild = await createStubRsbuild({
      action: 'build',
      rsbuildConfig: {},
    });
    buildRsbuild.addPlugins([pluginReactRouter({ customServer: true })]);
    const buildConfig = await buildRsbuild.unwrapConfig();

    expect(
      buildConfig.environments.node.source.entry[
        'static/js/react-router-server-build'
      ]
    ).toBeUndefined();
    expect(buildRsbuild.onBeforeDevCompile).not.toHaveBeenCalled();
    expect(buildRsbuild.onAfterDevCompile).not.toHaveBeenCalled();
    expect(buildRsbuild.onAfterCreateCompiler).not.toHaveBeenCalled();
  });

  it('should restart the dev server when route entries are added', async () => {
    const rsbuild = await createStubRsbuild({
      rsbuildConfig: {
        dev: {
          watchFiles: {
            paths: 'custom.config.ts',
            type: 'reload-server',
          },
        },
      },
    });

    rsbuild.addPlugins([pluginReactRouter()]);
    const config = await rsbuild.unwrapConfig();

    expect(config.dev.watchFiles).toEqual(
      expect.arrayContaining([
        {
          paths: 'custom.config.ts',
          type: 'reload-server',
        },
        {
          paths: expect.stringMatching(
            /react-router\.config\.[cm]?[jt]sx?$/
          ),
          type: 'reload-server',
        },
        {
          paths: expect.stringMatching(/app\/routes\.[cm]?[jt]sx?$/),
          type: 'reload-page',
        },
        {
          paths: expect.stringMatching(/\.react-router\/route-watch$/),
          type: 'reload-server',
        },
      ])
    );
  });

  it('reloads the dev server when imported route config helpers change', async () => {
    testGlobal.__reactRouterTestJitiCache = {
      '/project/node_modules/jiti/dist/jiti.cjs': {
        filename: '/project/node_modules/jiti/dist/jiti.cjs',
      },
    };
    testGlobal.__reactRouterTestJitiCacheAfterImport = {
      '/project/app/routes.ts': {
        filename: '/project/app/routes.ts',
      },
      '/project/app/dev-routes.ts': {
        filename: '/project/app/dev-routes.ts',
      },
    };

    const rsbuild = await createStubRsbuild({
      rsbuildConfig: {},
    });

    rsbuild.addPlugins([pluginReactRouter()]);
    const config = await rsbuild.unwrapConfig();

    expect(config.dev.watchFiles).toEqual(
      expect.arrayContaining([
          {
            paths: expect.arrayContaining([
              expect.stringMatching(/app\/routes\.[cm]?[jt]sx?$/),
              expect.stringMatching(/app\/dev-routes\.ts$/),
            ]),
            type: 'reload-page',
          },
      ])
    );
  });

  it('watches all supported config filenames when the config does not exist yet', async () => {
    const existsSyncMock = fs.existsSync as unknown as {
      mockImplementation: (implementation: (path: unknown) => boolean) => void;
      mockReturnValue: (value: boolean) => void;
    };
    existsSyncMock.mockImplementation(
      path => !String(path).includes('react-router.config')
    );

    try {
      const rsbuild = await createStubRsbuild({
        rsbuildConfig: {},
      });

      rsbuild.addPlugins([pluginReactRouter()]);
      const config = await rsbuild.unwrapConfig();
      const configWatch = config.dev.watchFiles.find(
        (watchFile: { paths: unknown }) => Array.isArray(watchFile.paths)
      );

      expect(configWatch).toMatchObject({
        paths: expect.arrayContaining([
          expect.stringMatching(/react-router\.config\.tsx$/),
          expect.stringMatching(/react-router\.config\.ts$/),
          expect.stringMatching(/react-router\.config\.jsx$/),
          expect.stringMatching(/react-router\.config\.js$/),
          expect.stringMatching(/react-router\.config\.mjs$/),
          expect.stringMatching(/react-router\.config\.mts$/),
        ]),
        type: 'reload-server',
      });
    } finally {
      existsSyncMock.mockReturnValue(true);
    }
  });

  it('reports the canonical routes.ts path when the route config is missing', async () => {
    const existsSync = rstest.spyOn(fs, 'existsSync').mockImplementation(path => {
      const filePath = String(path);
      // Route config file is absent for every probed extension.
      if (/app[\\/]routes\.[cm]?[jt]sx?$/.test(filePath)) {
        return false;
      }
      return true;
    });

    try {
      const rsbuild = await createStubRsbuild({
        rsbuildConfig: {},
      });

      rsbuild.addPlugins([pluginReactRouter()]);

      await expect(rsbuild.unwrapConfig()).rejects.toThrow(
        /Route config file not found at ".*app[\\/]routes\.ts"\./
      );
    } finally {
      existsSync.mockReturnValue(true);
    }
  });

  it('reloads the dev server when imported config helpers change', async () => {
    const existsSync = rstest.spyOn(fs, 'existsSync').mockImplementation(path => {
      const filePath = String(path);
      if (filePath.includes('react-router.config')) {
        return filePath.endsWith('react-router.config.ts');
      }
      return (
        filePath.endsWith('app/routes.ts') ||
        filePath.endsWith('app/root.tsx')
      );
    });
    testGlobal.__reactRouterTestJitiCache = {
      '/project/node_modules/jiti/dist/jiti.cjs': {
        filename: '/project/node_modules/jiti/dist/jiti.cjs',
      },
    };
    testGlobal.__reactRouterTestJitiCacheAfterImport = {
      '/project/react-router.config.ts': {
        filename: '/project/react-router.config.ts',
      },
      '/project/config/server-bundles.ts': {
        filename: '/project/config/server-bundles.ts',
      },
    };

    try {
      const rsbuild = await createStubRsbuild({
        rsbuildConfig: {},
      });

      rsbuild.addPlugins([pluginReactRouter()]);
      const config = await rsbuild.unwrapConfig();

      expect(config.dev.watchFiles).toEqual(
        expect.arrayContaining([
          {
            paths: expect.arrayContaining([
              expect.stringMatching(/react-router\.config\.ts$/),
              expect.stringMatching(/config\/server-bundles\.ts$/),
            ]),
            type: 'reload-server',
          },
        ])
      );
    } finally {
      existsSync.mockReturnValue(true);
    }
  });

  it('lets custom route topology callbacks own route restart handling', async () => {
    const rsbuild = await createStubRsbuild({
      rsbuildConfig: {},
    });

    rsbuild.addPlugins([
      pluginReactRouter({
        onRouteTopologyChange: () => {},
      }),
    ]);
    const config = await rsbuild.unwrapConfig();

    expect(config.dev.watchFiles).toEqual(
      expect.arrayContaining([
        {
          paths: expect.stringMatching(
            /react-router\.config\.[cm]?[jt]sx?$/
          ),
          type: 'reload-server',
        },
      ])
    );
    expect(config.dev.watchFiles).not.toEqual(
      expect.arrayContaining([
        {
          paths: expect.stringMatching(/app\/routes\.[cm]?[jt]sx?$/),
          type: 'reload-server',
        },
      ])
    );
    expect(config.dev.watchFiles).not.toEqual(
      expect.arrayContaining([
        {
          paths: expect.stringMatching(/\.react-router\/route-watch$/),
          type: 'reload-server',
        },
      ])
    );
  });

  it('should respect server output format', async () => {
    const rsbuild = await createStubRsbuild({
      rsbuildConfig: {},
    });

    rsbuild.addPlugins([pluginReactRouter({ serverOutput: 'commonjs' })]);
    const config = await rsbuild.unwrapConfig();

    const nodeConfig = config.environments?.node?.tools?.rspack;
    expect(nodeConfig.output.chunkFormat).toBe('commonjs');
    expect(nodeConfig.output.chunkLoading).toBe('require');
    expect(nodeConfig.output.module).toBe(false);
  });

  it('configures web entries to avoid unnecessary entry IIFEs', async () => {
    const rsbuild = await createStubRsbuild({
      rsbuildConfig: {},
    });

    rsbuild.addPlugins([pluginReactRouter()]);
    const config = await rsbuild.unwrapConfig();

    expect(
      config.environments?.web?.tools?.rspack?.optimization?.avoidEntryIife
    ).toBe(true);
  });

  it('preserves user web splitChunks overrides', async () => {
    const rsbuild = await createStubRsbuild({
      rsbuildConfig: {
        environments: {
          web: {
            tools: {
              rspack: {
                optimization: {
                  splitChunks: { chunks: 'all' },
                },
              },
            },
          },
        },
      },
    });

    rsbuild.addPlugins([pluginReactRouter()]);
    const config = await rsbuild.unwrapConfig();

    expect(
      config.environments?.web?.tools?.rspack?.optimization?.splitChunks
    ).toEqual({ chunks: 'all' });
    expect(
      config.environments?.web?.tools?.rspack?.optimization?.runtimeChunk
    ).toBe('single');
  });

  it('composes RSC bundler plumbing with the React Router environments', async () => {
    const rsbuild = await createStubRsbuild({
      rsbuildConfig: {},
    });

    rsbuild.addPlugins([pluginReactRouter({ rsc: true })]);
    const config = await rsbuild.unwrapConfig();

    expect(config.tools.swc.rspackExperiments.reactServerComponents).toBe(
      true
    );
    expect(config.environments.node.source.include).toEqual([
      {
        not: /[\\/]core-js[\\/]/,
      },
    ]);
    expect(config.environments.node.tools.rspack.dependencies).toBeUndefined();
    expect(config.environments.web.output.target).toBe('web');
    const webRspack = await rsbuild.unwrapRspackConfig('web');
    expect(webRspack.output.workerChunkLoading).toBe('import-scripts');
    expect(
      config.environments.web.tools.rspack.optimization.usedExports
    ).toBeUndefined();
    expect(
      config.environments.web.tools.rspack.optimization.mangleExports
    ).toBeUndefined();
  });

  it('shrinks classic production browser output', async () => {
    const rsbuild = await createStubRsbuild({
      action: 'build',
      rsbuildConfig: {},
    });

    rsbuild.addPlugins([pluginReactRouter()]);
    const config = await rsbuild.unwrapConfig();

    expect(config.environments.web.tools.rspack.optimization).toMatchObject({
      mangleExports: 'size',
      usedExports: 'global',
    });
    const webRspack = await rsbuild.unwrapRspackConfig('web');
    expect(webRspack.output.chunkFilename).toBe(
      'static/js/async/[id]-[contenthash:16].js'
    );
  });

  it('keeps classic development export names and chunk names', async () => {
    const rsbuild = await createStubRsbuild({
      rsbuildConfig: {},
    });

    rsbuild.addPlugins([pluginReactRouter()]);
    const config = await rsbuild.unwrapConfig();

    expect(
      config.environments.web.tools.rspack.optimization.mangleExports
    ).toBeUndefined();
    expect(
      config.environments.web.tools.rspack.optimization.usedExports
    ).toBeUndefined();
    const webRspack = await rsbuild.unwrapRspackConfig('web');
    expect(webRspack.output.chunkFilename).toBeUndefined();
  });

  // https://github.com/rstackjs/rsbuild-plugin-react-router/issues/129
  it('does not force web output.filename.js and yields chunkFilename to a user filename', async () => {
    const rsbuild = await createStubRsbuild({
      action: 'build',
      rsbuildConfig: {
        environments: {
          web: { output: { filename: { js: '[name]-[contenthash:8].js' } } },
        },
      },
    });

    rsbuild.addPlugins([pluginReactRouter()]);
    const config = await rsbuild.unwrapConfig();

    expect(config.environments.web.output.filename.js).toBe(
      '[name]-[contenthash:8].js'
    );
    // Rsbuild derives the async chunk name from `filename.js`; the plugin's
    // `[id]-[contenthash:16]` default must not override the user's scheme.
    const webRspack = await rsbuild.unwrapRspackConfig('web');
    expect(webRspack.output.chunkFilename).toBeUndefined();
  });

  it('leaves web output.filename.js to Rsbuild defaults when unset', async () => {
    const rsbuild = await createStubRsbuild({
      action: 'build',
      rsbuildConfig: {},
    });

    rsbuild.addPlugins([pluginReactRouter()]);
    const config = await rsbuild.unwrapConfig();

    expect(config.environments.web.output?.filename?.js).toBeUndefined();
    expect(config.output?.filename?.js).toBeUndefined();
  });

  it('lets user tools.rspack override plugin rspack output defaults', async () => {
    const rsbuild = await createStubRsbuild({
      action: 'build',
      rsbuildConfig: {
        environments: {
          web: {
            tools: {
              rspack: (rspackConfig: any) => {
                rspackConfig.output.chunkFilename = 'chunks/[name].js';
              },
            },
          },
        },
      },
    });

    rsbuild.addPlugins([pluginReactRouter()]);
    const webRspack = await rsbuild.unwrapRspackConfig('web');

    expect(webRspack.output.chunkFilename).toBe('chunks/[name].js');
    expect(webRspack.output.chunkFormat).toBe('module');
  });

  // https://github.com/rstackjs/rsbuild-plugin-react-router/issues/130
  it('does not copy the asset prefix onto web output.publicPath', async () => {
    const rsbuild = await createStubRsbuild({
      action: 'build',
      rsbuildConfig: {
        output: { assetPrefix: '/' },
        environments: { web: { output: { assetPrefix: 'auto' } } },
      },
    });

    rsbuild.addPlugins([pluginReactRouter()]);
    const config = await rsbuild.unwrapConfig();
    const webRspack = await rsbuild.unwrapRspackConfig('web');

    expect(webRspack.output.publicPath).toBeUndefined();
    expect(config.environments.web.output.assetPrefix).toBe('auto');
  });

  it('preserves production export names for RSC builds', async () => {
    const rsbuild = await createStubRsbuild({
      action: 'build',
      rsbuildConfig: {},
    });

    rsbuild.addPlugins([pluginReactRouter({ rsc: true })]);
    const config = await rsbuild.unwrapConfig();

    expect(config.environments.web.tools.rspack.optimization).toMatchObject({
      mangleExports: false,
      usedExports: false,
    });
  });

  it('does not revalidate RSC routes after lazy compilation', async () => {
    rstest.useFakeTimers();
    try {
      const rsbuild = await createStubRsbuild({
        rsbuildConfig: {},
      });
      const sockWrite = rstest.fn();

      rsbuild.addPlugins([pluginReactRouter({ rsc: true })]);
      await rsbuild.unwrapConfig();

      const beforeStartDevServer =
        rsbuild.onBeforeStartDevServer.mock.calls[0][0];
      const afterRscEnvironmentCompile =
        rsbuild.onAfterEnvironmentCompile.mock.calls[1][0];
      beforeStartDevServer({ server: { sockWrite } });
      afterRscEnvironmentCompile({
        environment: { name: 'node' },
        stats: {
          hasErrors: () => false,
          compilation: {
            compiler: {
              modifiedFiles: new Set<string>(),
              removedFiles: new Set<string>(),
            },
          },
        },
      });

      await rstest.advanceTimersByTimeAsync(1_001);
      expect(sockWrite).not.toHaveBeenCalled();
    } finally {
      rstest.useRealTimers();
    }
  });

  it('recognizes RSC client modules with leading comments safely', async () => {
    const fixtureDirectory = fs.mkdtempSync(join(tmpdir(), 'rr-rsc-client-'));
    const clientModulePath = join(fixtureDirectory, 'client.tsx');
    fs.writeFileSync(
      clientModulePath,
      '\uFEFF#!/usr/bin/env node\n/* first *//* second */\n"use client";\n'
    );
    rstest.useFakeTimers();
    try {
      const rsbuild = await createStubRsbuild({
        rsbuildConfig: {},
      });
      const sockWrite = rstest.fn();

      rsbuild.addPlugins([pluginReactRouter({ rsc: true })]);
      await rsbuild.unwrapConfig();

      const beforeStartDevServer =
        rsbuild.onBeforeStartDevServer.mock.calls[0][0];
      const afterRscEnvironmentCompile =
        rsbuild.onAfterEnvironmentCompile.mock.calls[1][0];
      beforeStartDevServer({ server: { sockWrite } });
      afterRscEnvironmentCompile({
        environment: { name: 'node' },
        stats: {
          hasErrors: () => false,
          compilation: {
            compiler: {
              modifiedFiles: new Set([clientModulePath]),
              removedFiles: new Set<string>(),
            },
          },
        },
      });

      await rstest.advanceTimersByTimeAsync(1_001);
      expect(sockWrite).not.toHaveBeenCalled();
    } finally {
      rstest.useRealTimers();
      fs.rmSync(fixtureDirectory, { force: true, recursive: true });
    }
  });

  it('installs the RSC dev request handler for SPA mode', async () => {
    const rsbuild = await createStubRsbuild({
      rsbuildConfig: {},
    });

    rsbuild.addPlugins([pluginReactRouter({ rsc: true, ssr: false })]);
    const config = await rsbuild.unwrapConfig();

    expect(config.server.setup).toBeDefined();
  });

  it('rejects RSC mode when legacy future SRI normalizes to unsupported SRI', async () => {
    testGlobal.__reactRouterTestConfig = {
      future: { unstable_subResourceIntegrity: true },
    };
    const rsbuild = await createStubRsbuild({
      rsbuildConfig: {},
    });

    rsbuild.addPlugins([pluginReactRouter({ rsc: true })]);

    await expect(rsbuild.unwrapConfig()).rejects.toThrow(
      /subResourceIntegrity/
    );
  });

  it('exposes an explicit RSC plugin helper', async () => {
    const rsbuild = await createStubRsbuild({
      rsbuildConfig: {},
    });

    rsbuild.addPlugins([pluginReactRouterRSC()]);
    const config = await rsbuild.unwrapConfig();

    expect(config.environments.web.source.entry).toEqual({
      index: {
        import: expect.stringMatching(/entry\.rsc\.client/),
        html: false,
      },
    });
    expect(config.environments.node.source.entry.index).toMatchObject({
      import: expect.stringMatching(/entry\.rsc/),
      layer: 'react-server-components',
    });
  });

  it('publishes option types from the package root declarations', () => {
    const outDir = fs.mkdtempSync(join(tmpdir(), 'rr-plugin-dts-'));

    try {
      execFileSync(
        'pnpm',
        [
          'exec',
          'tsc',
          '-p',
          'tsconfig.json',
          '--emitDeclarationOnly',
          '--outDir',
          outDir,
          '--tsBuildInfoFile',
          join(outDir, 'tsconfig.tsbuildinfo'),
          '--isolatedDeclarations',
          'false',
        ],
        { cwd: process.cwd(), stdio: 'pipe' }
      );

      const rootDeclarations = fs.readFileSync(
        join(outDir, 'index.d.ts'),
        'utf8'
      );

      expect(rootDeclarations).toContain(
        "export type { Config as ReactRouterRsbuildConfig } from './react-router-config.js';"
      );
      expect(rootDeclarations).toContain(
        "export type { PluginOptions, ReactRouterRSCPluginOptions } from './types.js';"
      );
    } finally {
      fs.rmSync(outDir, { force: true, recursive: true });
    }
  });

  it('reduces file size reporting overhead for medium split route builds by default', async () => {
    const restoreEnv = captureEnv([
      'RR_TEST_SPLIT_ROUTE_MODULES',
      'RR_TEST_ROUTE_COUNT',
    ]);
    process.env.RR_TEST_SPLIT_ROUTE_MODULES = 'true';
    process.env.RR_TEST_ROUTE_COUNT = '256';
    const readFileSync = rstest
      .spyOn(fs, 'readFileSync')
      .mockReturnValue('export default function Route() { return null; }');
    try {
      const rsbuild = await createStubRsbuild({
        action: 'build',
        rsbuildConfig: {},
      });

      rsbuild.addPlugins([pluginReactRouter()]);
      const config = await rsbuild.unwrapConfig();

      expect(config.performance?.printFileSize).toEqual({
        total: true,
        detail: false,
        compressed: false,
      });
    } finally {
      readFileSync.mockRestore();
      restoreEnv();
    }
  });

  it('reduces file size reporting overhead for medium route builds by default', async () => {
    const restoreEnv = captureEnv(['RR_TEST_ROUTE_COUNT']);
    process.env.RR_TEST_ROUTE_COUNT = '256';
    const readFileSync = rstest
      .spyOn(fs, 'readFileSync')
      .mockReturnValue('export default function Route() { return null; }');
    try {
      const rsbuild = await createStubRsbuild({
        action: 'build',
        rsbuildConfig: {},
      });

      rsbuild.addPlugins([pluginReactRouter()]);
      const config = await rsbuild.unwrapConfig();

      expect(config.performance?.printFileSize).toEqual({
        total: true,
        detail: false,
        compressed: false,
      });
    } finally {
      readFileSync.mockRestore();
      restoreEnv();
    }
  });

  it('keeps explicit object file size reporting config for large split route builds', async () => {
    const restoreEnv = captureEnv([
      'RR_TEST_SPLIT_ROUTE_MODULES',
      'RR_TEST_ROUTE_COUNT',
    ]);
    process.env.RR_TEST_SPLIT_ROUTE_MODULES = 'true';
    process.env.RR_TEST_ROUTE_COUNT = '1024';
    const readFileSync = rstest
      .spyOn(fs, 'readFileSync')
      .mockReturnValue('export default function Route() { return null; }');
    try {
      const rsbuild = await createStubRsbuild({
        action: 'build',
        rsbuildConfig: {
          performance: {
            printFileSize: {
              detail: true,
              compressed: true,
            },
          },
        },
      });

      rsbuild.addPlugins([pluginReactRouter()]);
      const config = await rsbuild.unwrapConfig();

      expect(config.performance?.printFileSize).toEqual({
        detail: true,
        compressed: true,
      });
    } finally {
      readFileSync.mockRestore();
      restoreEnv();
    }
  });

  it('should forward lazy compilation when explicitly configured', async () => {
    const rsbuild = await createStubRsbuild({
      rsbuildConfig: {},
    });

    rsbuild.addPlugins([
      pluginReactRouter({
        lazyCompilation: {
          entries: true,
          imports: true,
        },
      }),
    ]);
    const config = await rsbuild.unwrapConfig();

    expect(config.dev.lazyCompilation).toMatchObject({
      entries: true,
      imports: true,
    });
    const test = getLazyCompilationTest(config.dev.lazyCompilation);
    expect(
      test({
        resource: '/project/app/root.tsx?__react-router-build-client-route',
      })
    ).toBe(false);
    expect(
      test({
        resource: '/project/app/components/card.tsx',
        nameForCondition: () => '/project/app/components/card.tsx',
      })
    ).toBe(true);
  });

  it('should allow lazy compilation to be enabled with a boolean', async () => {
    const rsbuild = await createStubRsbuild({
      rsbuildConfig: {},
    });

    rsbuild.addPlugins([pluginReactRouter({ lazyCompilation: true })]);
    const config = await rsbuild.unwrapConfig();

    expect(config.dev.lazyCompilation).toMatchObject({
      entries: true,
      imports: true,
    });
    const test = getLazyCompilationTest(config.dev.lazyCompilation);
    expect(
      test({
        resource: `${process.cwd()}/app/entry.client.tsx`,
      })
    ).toBe(false);
  });

  it('allows lazy React Router entry and route modules when prewarming is enabled', async () => {
    const rsbuild = await createStubRsbuild({
      rsbuildConfig: {},
    });

    rsbuild.addPlugins([
      pluginReactRouter({
        lazyCompilation: true,
        unstableLazyCompilationPrewarm: true,
      }),
    ]);
    const config = await rsbuild.unwrapConfig();

    expect(rsbuild.onAfterStartDevServer).toHaveBeenCalled();
    expect(rsbuild.onAfterDevCompile).toHaveBeenCalled();
    expect(rsbuild.onAfterCreateCompiler).toHaveBeenCalled();
    expect(rsbuild.onCloseDevServer).toHaveBeenCalled();
    expect(config.dev.lazyCompilation).toMatchObject({
      entries: true,
      imports: true,
    });

    const test = getLazyCompilationTest(config.dev.lazyCompilation);
    expect(
      test({
        resource: `${process.cwd()}/app/entry.client.tsx`,
      })
    ).toBe(true);
    expect(
      test({
        nameForCondition: () =>
          '/project/app/routes/home.tsx?react-router-route',
      })
    ).toBe(true);
    expect(
      test({
        resource: 'virtual/react-router/browser-manifest',
      })
    ).toBe(false);
  });

  it('guards direct Rsbuild lazy compilation config for React Router hydration entries', async () => {
    const rsbuild = await createStubRsbuild({
      rsbuildConfig: {
        dev: {
          lazyCompilation: {
            entries: true,
            imports: false,
            test: /app/,
          },
        },
      },
    });

    rsbuild.addPlugins([pluginReactRouter()]);
    const config = await rsbuild.unwrapConfig();

    expect(config.dev.lazyCompilation).toMatchObject({
      entries: true,
      imports: false,
    });
    const test = getLazyCompilationTest(config.dev.lazyCompilation);
    expect(
      test({
        resource: '/project/app/routes/home.tsx?__react-router-build-client-route',
      })
    ).toBe(false);
    expect(
      test({
        resource: '/project/app/components/card.tsx',
        nameForCondition: () => '/project/app/components/card.tsx',
      })
    ).toBe(true);
    expect(
      test({
        resource: '/project/vendor/react.tsx',
        nameForCondition: () => '/project/vendor/react.tsx',
      })
    ).toBe(false);
  });

  it('guards the RSC client hydration entry from lazy compilation in RSC mode', async () => {
    const rsbuild = await createStubRsbuild({
      rsbuildConfig: {
        dev: {
          lazyCompilation: {
            entries: true,
            imports: true,
            test: /entry\.rsc\.client/,
          },
        },
      },
    });

    rsbuild.addPlugins([pluginReactRouter({ rsc: true })]);
    const config = await rsbuild.unwrapConfig();
    const test = getLazyCompilationTest(config.dev.lazyCompilation);
    const rscClientEntry = config.environments.web.source.entry.index.import;

    expect(
      test({
        resource: rscClientEntry,
        nameForCondition: () => rscClientEntry,
      })
    ).toBe(false);
  });

  it('should allow lazy compilation to be disabled', async () => {
    const rsbuild = await createStubRsbuild({
      rsbuildConfig: {},
    });

    rsbuild.addPlugins([pluginReactRouter({ lazyCompilation: false })]);
    const config = await rsbuild.unwrapConfig();

    expect(config.dev.lazyCompilation).toBe(false);
  });

  it('should configure web environment correctly', async () => {
    const rsbuild = await createStubRsbuild({
      rsbuildConfig: {},
    });

    rsbuild.addPlugins([pluginReactRouter()]);
    const config = await rsbuild.unwrapConfig();

    const webConfig = config.environments?.web?.tools?.rspack;
    expect(webConfig.experiments.outputModule).toBe(true);
    expect(webConfig.externalsType).toBe('module');
    expect(webConfig.output.chunkFormat).toBe('module');
    expect(webConfig.output.module).toBe(true);

    const webEntries = config.environments?.web?.source?.entry;
    // entry.client must set `html: false` so rsbuild does not emit a stray
    // entry.client.html into build/client.
    expect(webEntries['entry.client']).toMatchObject({
      import: expect.stringMatching(/entry\.client/),
      html: false,
    });
    expect(webEntries['virtual/react-router/browser-manifest']).toEqual({
      import: 'virtual/react-router/browser-manifest',
      html: false,
    });
    expect(webEntries['routes/index']).toMatchObject({
      html: false,
    });
  });

  it('should enable Rsbuild SRI for the web environment when configured', async () => {
    testGlobal.__reactRouterTestConfig = {
      subResourceIntegrity: true,
    };
    const rsbuild = await createStubRsbuild({
      rsbuildConfig: {},
    });

    rsbuild.addPlugins([pluginReactRouter()]);
    const config = await rsbuild.unwrapConfig();

    expect(config.environments?.web?.security?.sri?.enable).toBe(true);
    expect(config.environments?.node?.security?.sri).toBeUndefined();
  });

  it('should configure node environment correctly', async () => {
    const rsbuild = await createStubRsbuild({
      rsbuildConfig: {},
    });

    rsbuild.addPlugins([pluginReactRouter()]);
    const config = await rsbuild.unwrapConfig();

    const nodeConfig = config.environments?.node?.tools?.rspack;
    expect(nodeConfig.externals).toContain('express');
    expect(nodeConfig.experiments.outputModule).toBe(true);
    const nodeRspack = await rsbuild.unwrapRspackConfig('node');
    expect(nodeRspack.output.devtoolModuleFilenameTemplate).toBe(
      '[absolute-resource-path]'
    );
    expect(nodeRspack.output.devtoolFallbackModuleFilenameTemplate).toBe(
      '[absolute-resource-path]?[hash]'
    );
  });

  it('should apply the resolved development compiler dependency policy', async () => {
    const rsbuild = await createStubRsbuild({
      rsbuildConfig: {},
    });

    rsbuild.addPlugins([pluginReactRouter()]);
    const config = await rsbuild.unwrapConfig();

    const nodeConfig = config.environments?.node?.tools?.rspack;
    expect(nodeConfig.dependencies).toEqual(
      shouldParallelizeEnvironmentBuilds({ isBuild: false })
        ? undefined
        : ['web']
    );
  });

  it.each([
    [{ isBuild: false, spareCoreCount: 4 }, true],
    [{ isBuild: false, spareCoreCount: 3 }, false],
    [{ isBuild: false, spareCoreCount: 1 }, false],
    [{ isBuild: false, spareCoreCount: 0 }, false],
    [{ isBuild: true, spareCoreCount: 8 }, false],
  ])('should resolve parallel environment build mode', (options, expected) => {
    expect(shouldParallelizeEnvironmentBuilds(options)).toBe(expected);
  });

  it('should keep the node compiler dependent on web during production builds', async () => {
    const rsbuild = await createStubRsbuild({
      action: 'build',
      rsbuildConfig: {},
    });

    rsbuild.addPlugins([pluginReactRouter()]);
    const config = await rsbuild.unwrapConfig();

    const nodeConfig = config.environments?.node?.tools?.rspack;
    expect(nodeConfig.dependencies).toEqual(['web']);
  });

  it('should use async-node target for federation builds', async () => {
    const rsbuild = await createStubRsbuild({
      rsbuildConfig: {
        environments: {
          node: {
            tools: {
              rspack: {
                target: 'async-node',
              },
            },
          },
        },
      },
    });

    rsbuild.addPlugins([pluginReactRouter({ federation: true })]);
    const config = await rsbuild.unwrapConfig();

    const nodeConfig = config.environments?.node?.tools?.rspack;
    expect(nodeConfig.target).toBe('async-node');
  });
});
