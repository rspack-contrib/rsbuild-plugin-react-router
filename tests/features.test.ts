import { createStubRsbuild } from '@scripts/test-helper';
import { describe, expect, it, rstest } from '@rstest/core';
import { rspack, type Rspack } from '@rsbuild/core';
import * as fs from 'node:fs';
import path from 'node:path';
import { pluginReactRouter } from '../src';
import { getVirtualModuleFilePath } from '../src/virtual-modules';

type ReactRouterTestGlobal = typeof globalThis & {
  __reactRouterTestConfig?: unknown;
};

const testGlobal = globalThis as ReactRouterTestGlobal;

const getServerSetupNames = (config: {
  server?: { setup?: unknown };
}): string[] =>
  [config.server?.setup]
    .flat()
    .filter((fn): fn is (...args: unknown[]) => unknown => Boolean(fn))
    .map(fn => fn.name);

describe('pluginReactRouter', () => {
  describe('basic configuration', () => {
    it('should apply default options when no options provided', async () => {
      const rsbuild = await createStubRsbuild({
        rsbuildConfig: {},
      });

      rsbuild.addPlugins([pluginReactRouter()]);
      const config = await rsbuild.unwrapConfig();

      // The plugin should not override Rsbuild's HMR defaults.
      expect(config.dev.hmr).toBe(true);
      expect(config.dev.liveReload).toBe(true);
      expect(config.dev.writeToDisk).toBe(false);
    });

    it('should register the dev server middleware via server.setup', async () => {
      const rsbuild = await createStubRsbuild({
        rsbuildConfig: {},
      });

      rsbuild.addPlugins([pluginReactRouter()]);
      const config = await rsbuild.unwrapConfig();

      // The deprecated `dev.setupMiddlewares` API must stay untouched.
      expect(config.dev.setupMiddlewares).toBeUndefined();
      expect(getServerSetupNames(config)).toContain(
        'reactRouterDevServerSetup'
      );
    });

    it('should respect customServer option', async () => {
      const rsbuild = await createStubRsbuild({
        rsbuildConfig: {},
      });

      rsbuild.addPlugins([pluginReactRouter({ customServer: true })]);
      const config = await rsbuild.unwrapConfig();

      expect(config.dev.setupMiddlewares).toBeUndefined();
      expect(getServerSetupNames(config)).not.toContain(
        'reactRouterDevServerSetup'
      );
    });

    it('should register the dev middleware for SPA mode (ssr: false)', async () => {
      testGlobal.__reactRouterTestConfig = { ssr: false };
      const rsbuild = await createStubRsbuild({
        rsbuildConfig: {},
      });

      rsbuild.addPlugins([pluginReactRouter()]);
      const config = await rsbuild.unwrapConfig();

      expect(config.server.setup).toHaveLength(1);
    });

    it('should configure server output format correctly', async () => {
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
  });

  describe('environment configurations', () => {
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
    });
  });

  describe('virtual modules', () => {
    it('should register virtual modules', async () => {
      const rsbuild = await createStubRsbuild({
        rsbuildConfig: {},
      });

      rsbuild.addPlugins([pluginReactRouter()]);
      const config = await rsbuild.unwrapConfig();

      const plugins = config.tools?.rspack?.plugins || [];
      const virtualModulePlugin = plugins.find(
        (p: any) => p.constructor.name === 'VirtualModulesPlugin'
      );

      expect(virtualModulePlugin).toBeDefined();

      const compiler = {
        context: '/virtual/project',
        hooks: {
          afterEnvironment: {
            tap: (_name: string, handler: () => void) => handler(),
          },
        },
      } as any;
      virtualModulePlugin.apply(compiler);

      const virtualFiles =
        rspack.experiments.VirtualModulesPlugin.__internal__take_virtual_files(
          compiler
        );
      const virtualFilePaths = virtualFiles?.map(file => file.path) || [];
      const virtualModulePath = (id: string) =>
        path.join(compiler.context, getVirtualModuleFilePath(id));

      expect(virtualFilePaths).toContain(
        virtualModulePath('virtual/react-router/browser-manifest')
      );
      expect(virtualFilePaths).toContain(
        virtualModulePath('virtual/react-router/server-build')
      );
      expect(virtualFilePaths).toContain(
        virtualModulePath('virtual/react-router/with-props')
      );
      expect(virtualFilePaths).not.toContain(
        '/virtual/project/virtual/react-router/browser-manifest'
      );
    });

    it('should map bare React Router virtual module ids to resolvable files', () => {
      expect(
        getVirtualModuleFilePath('virtual/react-router/browser-manifest')
      ).toBe('node_modules/virtual/react-router/browser-manifest.js');
      expect(
        getVirtualModuleFilePath('virtual/react-router/server-build-edge')
      ).toBe('node_modules/virtual/react-router/server-build-edge.js');

      expect(() =>
        getVirtualModuleFilePath('virtual/react-router/../server-build')
      ).toThrow('Invalid virtual module id');
      expect(() =>
        getVirtualModuleFilePath('virtual/other/server-build')
      ).toThrow('Virtual module id must start');
    });
  });

  describe('route transformations', () => {
    it('should transform route files correctly', async () => {
      const rsbuild = await createStubRsbuild({
        rsbuildConfig: {},
      });

      rsbuild.addPlugins([pluginReactRouter()]);
      const config = await rsbuild.unwrapConfig();

      const transforms = config.transforms || [];
      const routeTransform = transforms.find(
        (t) => t.resourceQuery?.toString().includes('react-router-route')
      );

      expect(routeTransform).toBeDefined();
    });

    it('should register build, dot file, and route chunk transforms by default', async () => {
      const readFileSync = rstest
        .spyOn(fs, 'readFileSync')
        .mockReturnValue('export default function Route() { return null; }');
      const rsbuild = await createStubRsbuild({
        action: 'build',
        rsbuildConfig: {},
      });

      try {
        const plugin = pluginReactRouter();
        await plugin.setup(rsbuild as any);
      } finally {
        readFileSync.mockRestore();
      }

      const calls = (rsbuild.transform as any).mock.calls.map(
        (call: any[]) => call[0]
      );

      expect(
        calls.some(
          (call: any) =>
            call.resourceQuery?.toString().includes('__react-router-build-client-route')
        )
      ).toBe(true);

      expect(
        calls.some(
          (call: any) =>
            call.resourceQuery?.toString().includes('route-chunk=') &&
            call.environments?.includes('web')
        )
      ).toBe(true);

      const splitRouteExportsTransform = calls.find(
        (call: any) =>
          typeof call.test === 'function' &&
          call.resourceQuery?.not?.toString().includes('route-chunk=') &&
          call.environments?.includes('web')
      );
      expect(splitRouteExportsTransform).toBeDefined();
      expect(
        splitRouteExportsTransform.test(path.resolve('app/routes/index.tsx'))
      ).toBe(true);
      expect(splitRouteExportsTransform.test(path.resolve('app/other.tsx'))).toBe(
        false
      );

      expect(
        calls.some(
          (call: any) =>
            call.test?.toString().includes('\\.server') &&
            call.environments?.includes('web')
        )
      ).toBe(true);

      expect(
        calls.some(
          (call: any) =>
            call.test?.toString().includes('\\.client') &&
            call.environments?.includes('node')
        )
      ).toBe(true);
    });
  });

  describe('asset handling', () => {
    it('should treat non-CSS ?url imports as emitted assets in web and node builds', async () => {
      const rsbuild = await createStubRsbuild({
        rsbuildConfig: {},
      });

      rsbuild.addPlugins([pluginReactRouter()]);
      const config = await rsbuild.unwrapConfig();
      const getRules = (name: 'web' | 'node') =>
        config.environments?.[name]?.tools?.rspack?.module?.rules ?? [];
      const includedQueries = ['?url', '?url&foo=bar', '?foo=bar&url'];
      const excludedQueries = [
        '?raw',
        '?inline',
        '?url&raw',
        '?raw&url',
        '?url&inline',
        '?inline&url',
      ];
      const hasUrlAssetRule = (rule: {
        resourceQuery?: RegExp;
        exclude?: RegExp;
        type?: string;
      }) => {
        const { resourceQuery, exclude, type } = rule;
        return (
          resourceQuery instanceof RegExp &&
          exclude instanceof RegExp &&
          resourceQuery.toString().includes('url') &&
          exclude.test('app/styles.css') &&
          includedQueries.every(query => resourceQuery.test(query)) &&
          excludedQueries.every(query => !resourceQuery.test(query)) &&
          type === 'asset/resource'
        );
      };

      expect(getRules('web').some(hasUrlAssetRule)).toBe(true);
      expect(getRules('node').some(hasUrlAssetRule)).toBe(true);
    });

    it('aligns server CSS url imports with web dev CSS urls', async () => {
      const rsbuild = await createStubRsbuild({
        rsbuildConfig: {},
      });

      rsbuild.addPlugins([pluginReactRouter()]);
      const config = await rsbuild.unwrapConfig();
      const cssFilename = config.environments?.node?.output?.filename?.css as (
        pathData: Rspack.PathData
      ) => string;

      expect(
        cssFilename({
          chunk: {
            name: 'app/routes/css-with-links-export/styles-postcss-linked',
          },
        })
      ).toBe(
        'app/routes/css-with-links-export/styles-postcss-linked.css'
      );
    });

    it('keeps server CSS url imports in static assets for build', async () => {
      const rsbuild = await createStubRsbuild({
        action: 'build',
        rsbuildConfig: {},
      });

      rsbuild.addPlugins([pluginReactRouter()]);
      const config = await rsbuild.unwrapConfig();
      const cssFilename = config.environments?.node?.output?.filename?.css as (
        pathData: Rspack.PathData
      ) => string;

      expect(
        cssFilename({
          chunk: {
            name: 'app/routes/css-with-links-export/styles-postcss-linked',
          },
        })
      ).toBe('../assets/styles-postcss-linked.[contenthash:10].css');
    });

    it('routes server code-split chunks to static/js/async so they stay under the server build', async () => {
      const rsbuild = await createStubRsbuild({
        rsbuildConfig: {},
      });

      rsbuild.addPlugins([pluginReactRouter()]);
      const nodeRspack = await rsbuild.unwrapRspackConfig('node');

      expect(nodeRspack.output.chunkFilename).toBe('static/js/async/[name].js');
    });

    it('should emit package.json for node environment', async () => {
      const rsbuild = await createStubRsbuild({
        rsbuildConfig: {},
      });

      const processAssets = rstest.fn();
      rsbuild.processAssets = processAssets;

      const plugin = pluginReactRouter({ serverOutput: 'commonjs' });
      await plugin.setup(rsbuild);

      expect(processAssets).toHaveBeenCalledWith(
        expect.objectContaining({
          stage: 'additional',
          targets: ['node']
        }),
        expect.any(Function)
      );
    });
  });
});
