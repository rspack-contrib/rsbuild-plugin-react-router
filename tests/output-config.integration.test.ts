import * as fs from 'node:fs';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  createLogger,
  createRsbuild,
  type RsbuildConfig,
  type RsbuildPlugin,
  type Rspack,
} from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';
import { afterAll, beforeAll, describe, expect, it } from '@rstest/core';
import { pluginReactRouter, pluginReactRouterRSC } from '../src/index.js';

// Output precedence against real Rsbuild: `inspectConfig` runs the full
// pipeline (config normalization, environment hooks, `modifyRspackConfig`,
// then the user's `tools.rspack`) and returns the final Rspack configs, so
// these assertions cannot be distorted by a simulated merge (#129, #130).

const repositoryRoot = process.cwd();
let fixtureRoot: string;

beforeAll(() => {
  const temporaryFixtures = join(repositoryRoot, 'tests/.tmp-dev-runtime');
  mkdirSync(temporaryFixtures, { recursive: true });
  fixtureRoot = mkdtempSync(join(temporaryFixtures, 'output-'));
  cpSync(join(repositoryRoot, 'tests/fixtures/dev-runtime'), fixtureRoot, {
    recursive: true,
  });
  (fs.existsSync as { mockRestore?: () => void }).mockRestore?.();
  // The plugin resolves the app directory from the working directory.
  process.chdir(fixtureRoot);
});

afterAll(() => {
  process.chdir(repositoryRoot);
  rmSync(fixtureRoot, { recursive: true, force: true });
});

const create = (
  plugin: RsbuildPlugin,
  rsbuildConfig: RsbuildConfig = {},
  environment?: string[]
) =>
  createRsbuild({
    cwd: fixtureRoot,
    environment,
    rsbuildConfig: {
      root: fixtureRoot,
      customLogger: createLogger({ level: 'silent' }),
      ...rsbuildConfig,
      plugins: [plugin, pluginReact(), ...(rsbuildConfig.plugins ?? [])],
    },
  });

const inspect = async (
  plugin: RsbuildPlugin,
  rsbuildConfig: RsbuildConfig = {}
): Promise<Record<string, Rspack.Configuration>> => {
  const rsbuild = await create(plugin, rsbuildConfig);
  const { origin } = await rsbuild.inspectConfig({ mode: 'production' });
  return Object.fromEntries(
    origin.bundlerConfigs.map(config => [config.name, config])
  );
};

const output = (config: Rspack.Configuration) =>
  config.output as NonNullable<Rspack.Configuration['output']>;

describe('final Rspack output configuration (real Rsbuild)', () => {
  it('leaves browser filenames and publicPath to Rsbuild in classic mode', async () => {
    const { web, node } = await inspect(pluginReactRouter());

    // Rsbuild's production defaults, not a plugin override.
    expect(output(web).filename).toBe('static/js/[name].[contenthash:10].js');
    expect(output(web).chunkFilename).toBe(
      'static/js/async/[name].[contenthash:10].js'
    );
    expect(output(web).publicPath).toBe('/');
    // Plugin defaults that classic mode needs.
    expect(output(web)).toMatchObject({
      chunkFormat: 'module',
      chunkLoading: 'import',
      module: true,
      library: { type: 'module' },
    });
    // The server keeps deterministic filenames (React Router's server build
    // file) and the plugin's chunk layout under the server build.
    expect(output(node).filename).toBe('[name].js');
    expect(output(node).chunkFilename).toBe('static/js/async/[name].js');
    expect(output(node)).toMatchObject({
      chunkFormat: 'module',
      chunkLoading: 'import',
      module: true,
      library: { type: 'module' },
      devtoolModuleFilenameTemplate: '[absolute-resource-path]',
    });
  });

  it('honors a user web output.filename.js', async () => {
    const { web } = await inspect(pluginReactRouter(), {
      environments: {
        web: { output: { filename: { js: '[contenthash:8]-[name].js' } } },
      },
    });

    expect(output(web).filename).toBe('static/js/[contenthash:8]-[name].js');
    expect(output(web).chunkFilename).toBe(
      'static/js/async/[contenthash:8]-[name].js'
    );
  });

  it('lets user tools.rspack (function form) override plugin output defaults', async () => {
    const { web, node } = await inspect(pluginReactRouter(), {
      environments: {
        web: {
          tools: {
            rspack: config => {
              config.output!.chunkFilename = 'chunks/[name].js';
            },
          },
        },
        node: {
          tools: { rspack: { output: { chunkFilename: 'server-chunks/[name].js' } } },
        },
      },
    });

    expect(output(web).chunkFilename).toBe('chunks/[name].js');
    expect(output(web).chunkFormat).toBe('module');
    expect(output(node).chunkFilename).toBe('server-chunks/[name].js');
  });

  // https://github.com/rstackjs/rsbuild-plugin-react-router/issues/130
  it("passes a web assetPrefix of 'auto' through to the browser compiler", async () => {
    const { web } = await inspect(pluginReactRouter(), {
      output: { assetPrefix: 'https://cdn.example.com/app/' },
      environments: { web: { output: { assetPrefix: 'auto' } } },
    });

    expect(output(web).publicPath).toBe('auto');
  });

  // https://github.com/rstackjs/rsbuild-plugin-react-router/issues/132
  it('configures CommonJS server output and Module Federation invariants', async () => {
    const federationPlugin = (options: Record<string, unknown>) => ({
      name: 'ModuleFederationPlugin',
      _options: options,
      apply() {},
    });
    const webPlugin = federationPlugin({ name: 'host', shared: { react: {} } });
    const nodePlugin = federationPlugin({ name: 'host', shared: { react: {} } });
    const { web, node } = await inspect(
      pluginReactRouter({ serverOutput: 'commonjs', federation: true }),
      {
        environments: {
          web: { tools: { rspack: { plugins: [webPlugin] } } },
          node: { tools: { rspack: { plugins: [nodePlugin] } } },
        },
      }
    );

    expect(output(web).chunkLoading).toBe('import');
    expect(output(node)).toMatchObject({
      chunkFormat: 'commonjs',
      chunkLoading: 'async-node',
      workerChunkLoading: 'async-node',
      module: false,
      library: { type: 'commonjs2' },
    });
    expect(node.target).toBe('async-node');

    // Async startup is mandatory on every compiler; sharing stays as declared
    // (non-eager).
    expect(webPlugin._options.experiments).toEqual({ asyncStartup: true });
    expect(nodePlugin._options.experiments).toEqual({ asyncStartup: true });
    expect(webPlugin._options.shared).toEqual({ react: {} });

    // The container gets its own runtime chunk; app entries keep sharing one.
    const runtimeChunk = web.optimization?.runtimeChunk as {
      name: (entrypoint: { name: string }) => string;
    };
    expect(runtimeChunk.name({ name: 'host' })).toBe('runtime-host');
    expect(runtimeChunk.name({ name: 'entry.client' })).toBe('runtime');
    expect(runtimeChunk.name({ name: 'root' })).toBe('runtime');

    // The server build has no initial chunk dependencies for the async
    // startup gate; server code splitting stays async-only.
    expect(node.optimization?.splitChunks).toMatchObject({ chunks: 'async' });
  });

  it('keeps federation server splitting async-only past late overrides and presets', async () => {
    const { node: overridden } = await inspect(
      pluginReactRouter({ serverOutput: 'commonjs', federation: true }),
      {
        environments: {
          node: {
            // A user `tools.rspack` function runs after the plugin's defaults.
            tools: {
              rspack: config => {
                config.optimization!.splitChunks = {
                  ...(config.optimization!.splitChunks as object),
                  chunks: 'all',
                };
              },
            },
          },
        },
      }
    );
    expect(overridden.optimization?.splitChunks).toMatchObject({ chunks: 'async' });

    // Rsbuild's `single-vendor` preset adds an enforced cache group with
    // `chunks: 'all'`, which Rspack prefers over the global filter.
    const { node: preset } = await inspect(
      pluginReactRouter({ serverOutput: 'commonjs', federation: true }),
      { environments: { node: { splitChunks: { preset: 'single-vendor' } } } }
    );
    const splitChunks = preset.optimization?.splitChunks as {
      chunks: unknown;
      cacheGroups: Record<string, { chunks?: unknown; enforce?: boolean }>;
    };
    expect(splitChunks.chunks).toBe('async');
    const groups = Object.values(splitChunks.cacheGroups);
    expect(groups.length).toBeGreaterThan(0);
    for (const group of groups) {
      if ('chunks' in group) expect(group.chunks).toBe('async');
    }

    // An explicitly disabled splitChunks stays disabled.
    const { node: disabled } = await inspect(
      pluginReactRouter({ serverOutput: 'commonjs', federation: true }),
      { environments: { node: { splitChunks: false } } }
    );
    expect(disabled.optimization?.splitChunks).toBe(false);
  });

  it('keeps the shared browser runtime chunk without federation', async () => {
    const { web, node } = await inspect(pluginReactRouter());
    expect(web.optimization?.runtimeChunk).toBe('single');
    expect(node.optimization?.splitChunks).toMatchObject({ chunks: 'all' });
  });

  // `getNormalizedConfig({ environment: 'web' })` throws when the build is
  // narrowed to other environments; `onBeforeCreateCompiler` must not call it.
  it('creates the compiler when only the node environment is selected', async () => {
    const rsbuild = await create(
      pluginReactRouter({ lazyCompilation: false }),
      { output: { assetPrefix: 'https://cdn.example.com/app/' } },
      ['node']
    );
    const compiler = await rsbuild.createCompiler();
    try {
      const names =
        'compilers' in compiler
          ? compiler.compilers.map(child => child.name)
          : [compiler.name];
      expect(names).toEqual(['node']);
      expect(rsbuild.getNormalizedConfig().environments.web).toBeUndefined();
    } finally {
      await new Promise<void>((resolve, reject) =>
        compiler.close(error => (error ? reject(error) : resolve()))
      );
    }
  }, 60_000);

  it('configures RSC browser output', async () => {
    const { web } = await inspect(pluginReactRouterRSC());

    expect(output(web)).toMatchObject({
      chunkFormat: 'array-push',
      chunkLoading: 'jsonp',
      workerChunkLoading: 'import-scripts',
      module: false,
    });
    expect(output(web).filename).toBe('static/js/[name].[contenthash:10].js');
  });
});
