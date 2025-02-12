import { createStubRsbuild } from '@scripts/test-helper';
import { describe, expect, it, vi } from 'vitest';
import { pluginReactRouter } from '../src';

describe('pluginReactRouter', () => {
  describe('basic configuration', () => {
    it('should apply default options when no options provided', async () => {
      const rsbuild = await createStubRsbuild({
        rsbuildConfig: {},
      });

      rsbuild.addPlugins([pluginReactRouter()]);
      const config = await rsbuild.unwrapConfig();

      expect(config.dev.hmr).toBe(false);
      expect(config.dev.liveReload).toBe(true);
      expect(config.dev.writeToDisk).toBe(true);
    });

    it('should respect customServer option', async () => {
      const rsbuild = await createStubRsbuild({
        rsbuildConfig: {},
      });

      rsbuild.addPlugins([pluginReactRouter({ customServer: true })]);
      const config = await rsbuild.unwrapConfig();

      expect(config.dev.setupMiddlewares).toEqual([]);
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
        (p) => p.constructor.name === 'RspackVirtualModulePlugin'
      );

      expect(virtualModulePlugin).toBeDefined();
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
  });

  describe('asset handling', () => {
    it('should emit package.json for node environment', async () => {
      const rsbuild = await createStubRsbuild({
        rsbuildConfig: {},
      });

      const processAssets = vi.fn();
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
