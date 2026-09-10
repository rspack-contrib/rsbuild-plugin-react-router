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
import { pluginReactRouter, pluginReactRouterRSC } from '../src';

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

const inspect = async (
  plugin: RsbuildPlugin,
  rsbuildConfig: RsbuildConfig = {}
): Promise<Record<string, Rspack.Configuration>> => {
  const rsbuild = await createRsbuild({
    cwd: fixtureRoot,
    rsbuildConfig: {
      root: fixtureRoot,
      customLogger: createLogger({ level: 'silent' }),
      ...rsbuildConfig,
      plugins: [plugin, pluginReact(), ...(rsbuildConfig.plugins ?? [])],
    },
  });
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

  it('configures CommonJS server output and federation chunk loading', async () => {
    const { web, node } = await inspect(
      pluginReactRouter({ serverOutput: 'commonjs', federation: true })
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
  });

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
