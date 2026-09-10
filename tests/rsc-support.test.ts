import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from '@rstest/core';
import {
  assertReactRouterRscConfigSupport,
  assertReactRouterRscSupport,
  createReactRouterRscResolveAliases,
  createReactRouterRscVirtualModules,
  setupReactRouterRscPlugin,
} from '../src/rsc-support';

describe('RSC support helpers', () => {
  it('creates aliases for upstream colon virtual IDs and internal client modules', () => {
    const aliases = createReactRouterRscResolveAliases('/repo');

    expect(aliases).toMatchObject({
      'virtual:react-router/unstable_rsc/routes': expect.stringContaining(
        'virtual/react-router/unstable_rsc/routes.js'
      ),
      'virtual/react-router/unstable_rsc/routes': expect.stringContaining(
        'virtual/react-router/unstable_rsc/routes.js'
      ),
      'react-router/internal/react-server-client': expect.stringContaining(
        'virtual/react-router/rsc-internal-client.js'
      ),
    });
  });

  it('aliases the SSR entry to the resolved user or template file', () => {
    const aliases = createReactRouterRscResolveAliases('/repo', {
      entrySsrPath: '/repo/app/entry.ssr.tsx',
    });

    expect(aliases['virtual/react-router/unstable_rsc/entry-ssr']).toBe(
      '/repo/app/entry.ssr.tsx'
    );
    expect(aliases['virtual:react-router/unstable_rsc/entry-ssr']).toBe(
      '/repo/app/entry.ssr.tsx'
    );
    expect(createReactRouterRscResolveAliases('/repo')).not.toHaveProperty(
      'virtual/react-router/unstable_rsc/entry-ssr'
    );
  });

  it('creates only RSC virtual modules with normalized bootstrap scripts', () => {
    const modules = createReactRouterRscVirtualModules({
      allowedActionOrigins: ['https://app.example.com'],
      appDirectory: '/repo/app',
      basename: '/',
      buildDirectory: '/repo/build',
      isBuild: false,
      outputClientPath: '/repo/build/client',
      publicPath: '/assets',
      routeDiscovery: { mode: 'initial' },
      routes: {
        root: {
          id: 'root',
          file: 'root.tsx',
          path: '',
        },
      },
      ssr: true,
    });

    expect(modules['virtual/react-router/server-build']).toBeUndefined();
    // Bootstrap scripts come from the rspack RSC manifest at runtime (so hashed
    // entry filenames work); the computed path is only the fallback.
    // The manifest-prefix module aligns `__webpack_require__.rscM` in place and
    // the bootstrap module then reads it. Evaluate both as plain scripts.
    const evaluate = (rscM: any) => {
      const rscManifest = new Function(
        '__webpack_require__',
        modules['virtual/react-router/unstable_rsc/manifest-prefix'].replace(
          'export const rscManifest =',
          'return'
        )
      )({ rscM });
      const bootstrap = new Function(
        'rscManifest',
        modules['virtual/react-router/unstable_rsc/bootstrap-scripts']
          .replace(/^import .*\n/, '')
          .replace('export default', 'return')
      )(rscManifest) as string[];
      return { bootstrap, rscM };
    };
    // Manifest already carries the prefix the server uses: untouched, with
    // the full list and its order preserved.
    const same = evaluate({
      entryJsFiles: ['/assets/static/js/index.abc123.js', '/assets/static/js/polyfill.js'],
      entryCssFiles: { 'root.tsx': ['/assets/static/css/root.css'] },
      clientManifest: { a: { cssFiles: ['/assets/static/css/a.css'] } },
      moduleLoading: { prefix: '/assets/' },
    });
    expect(same.bootstrap).toEqual([
      '/assets/static/js/index.abc123.js',
      '/assets/static/js/polyfill.js',
    ]);
    expect(same.rscM.entryCssFiles['root.tsx']).toEqual(['/assets/static/css/root.css']);
    expect(same.rscM.moduleLoading.prefix).toBe('/assets/');
    // Browser compiler on 'auto' (rspack records `/`), server prefix differs:
    // bootstrap scripts, route CSS, client-reference CSS, and Flight's preload
    // prefix all move to the server prefix, never stacking a second one.
    const entryCss = ['/static/css/async/768.css'];
    const swapped = evaluate({
      entryJsFiles: ['/static/js/index.abc123.js'],
      entryCssFiles: { 'root.tsx': entryCss },
      clientManifest: {
        a: { cssFiles: ['/static/css/async/757.css', 'https://other.example/x.css'] },
        b: {},
      },
      moduleLoading: { prefix: '/' },
    });
    expect(swapped.bootstrap).toEqual(['/assets/static/js/index.abc123.js']);
    // Mutated in place: consumers that captured the array earlier see it too.
    expect(entryCss).toEqual(['/assets/static/css/async/768.css']);
    expect(swapped.rscM.clientManifest.a.cssFiles).toEqual([
      '/assets/static/css/async/757.css',
      'https://other.example/x.css',
    ]);
    expect(swapped.rscM.moduleLoading.prefix).toBe('/assets/');
    // Idempotent: a second evaluation must not re-prefix.
    evaluate(swapped.rscM);
    expect(swapped.rscM.entryJsFiles).toEqual(['/assets/static/js/index.abc123.js']);
    // Empty browser prefix (web `assetPrefix: ''`): rspack emits relative
    // references, which are rebased onto the server prefix; absolute and
    // protocol-relative URLs are untouched.
    const relative = evaluate({
      entryJsFiles: ['static/js/index.abc123.js', 'https://other.example/x.js', '//cdn.example/y.js'],
      entryCssFiles: { 'root.tsx': ['static/css/root.css'] },
      clientManifest: {},
      moduleLoading: { prefix: '' },
    });
    expect(relative.bootstrap).toEqual([
      '/assets/static/js/index.abc123.js',
      'https://other.example/x.js',
      '//cdn.example/y.js',
    ]);
    expect(relative.rscM.entryCssFiles['root.tsx']).toEqual(['/assets/static/css/root.css']);
    expect(relative.rscM.moduleLoading.prefix).toBe('/assets/');
    // No entry script recorded (rspack drops non-`.js` names): fail loudly
    // rather than render a document that cannot hydrate.
    expect(() =>
      evaluate({ entryJsFiles: [], moduleLoading: { prefix: '/' } })
    ).toThrow(/lists no browser entry script/);
    // The RSC HMR runtime only self-accepts; the single `rsc:update` navigate
    // handler now lives in the RSC client entry, not this virtual module.
    expect(
      modules['virtual/react-router/unstable_rsc/inject-hmr-runtime']
    ).toContain('import.meta.webpackHot.accept()');
    expect(
      modules['virtual/react-router/unstable_rsc/allowed-action-origins']
    ).toBe('export default ["https://app.example.com"];');
    expect(
      modules['virtual/react-router/unstable_rsc/client-version']
    ).toBe('export default undefined;');
    expect(
      modules['virtual/react-router/unstable_rsc/server-manifest']
    ).toContain('__webpack_require__.rscM?.serverManifest');
  });

  it('defaults RSC route discovery for SSR and SPA mode', () => {
    const createModules = (
      ssr: boolean,
      routeDiscovery?: Parameters<
        typeof createReactRouterRscVirtualModules
      >[0]['routeDiscovery']
    ) =>
      createReactRouterRscVirtualModules({
        allowedActionOrigins: undefined,
        appDirectory: '/repo/app',
        basename: '/',
        buildDirectory: '/repo/build',
        isBuild: true,
        outputClientPath: '/repo/build/client',
        publicPath: '/',
        routeDiscovery,
        routes: {},
        ssr,
      });

    expect(
      createModules(true)[
        'virtual/react-router/unstable_rsc/route-discovery'
      ]
    ).toBe('export default {"mode":"lazy"};');
    expect(
      createModules(false, { mode: 'lazy' })[
        'virtual/react-router/unstable_rsc/route-discovery'
      ]
    ).toBe('export default {"mode":"initial"};');
  });

  it('derives the production RSC client version from the compilation hash', () => {
    const modules = createReactRouterRscVirtualModules({
      allowedActionOrigins: undefined,
      appDirectory: '/repo/app',
      basename: '/',
      buildDirectory: '/repo/build',
      isBuild: true,
      outputClientPath: '/repo/build/client',
      publicPath: '/',
      routeDiscovery: { mode: 'initial' },
      routes: {},
      ssr: true,
    });

    expect(
      modules['virtual/react-router/unstable_rsc/client-version']
    ).toBe('export default __webpack_hash__;');
  });

  it('rejects config options RSC framework mode does not support', () => {
    expect(() =>
      assertReactRouterRscConfigSupport({
        pluginName: 'test-plugin',
        userConfig: {
          buildEnd: async () => {},
          serverBundles: () => 'bundle',
          subResourceIntegrity: true,
        },
      })
    ).toThrow(
      /does not currently support[\s\S]*- buildEnd[\s\S]*- serverBundles[\s\S]*- subResourceIntegrity/
    );

    expect(() =>
      assertReactRouterRscConfigSupport({
        pluginName: 'test-plugin',
        userConfig: { ssr: true, basename: '/app' },
      })
    ).not.toThrow();
  });

  it('rejects the legacy SRI future alias after config normalization', () => {
    expect(() =>
      assertReactRouterRscConfigSupport({
        pluginName: 'test-plugin',
        userConfig: {
          future: { unstable_subResourceIntegrity: true },
          subResourceIntegrity: true,
        },
      })
    ).toThrow(/subResourceIntegrity/);
  });

  it('rejects separately registered rsbuild-plugin-rsc instances', async () => {
    await expect(
      setupReactRouterRscPlugin({
        api: {
          isPluginExists: () => true,
        } as any,
        entryRscPath: '/repo/app/entry.rsc.tsx',
        entrySsrPath: '/repo/app/entry.rsc.ssr.tsx',
        pluginName: 'test-plugin',
        rsc: {},
      })
    ).rejects.toThrow(/already registered/);
  });

  it('rejects React Router versions before the RSC export surface', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'rr-rsc-support-'));
    const packageJsonPath = join(tempDir, 'react-router.json');
    writeFileSync(packageJsonPath, JSON.stringify({ version: '7.17.0' }));

    try {
      expect(() =>
        assertReactRouterRscSupport({
          pluginName: 'test-plugin',
          resolvePackagePath: specifier =>
            specifier === 'react-router/package.json'
              ? packageJsonPath
              : '/repo/node_modules/fake.js',
        })
      ).toThrow('requires react-router >=7.18.0 or >=8.0.0');
    } finally {
      rmSync(tempDir, { force: true, recursive: true });
    }
  });

  it('rejects missing RSC runtime dependencies', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'rr-rsc-support-'));
    const packageJsonPath = join(tempDir, 'react-router.json');
    writeFileSync(packageJsonPath, JSON.stringify({ version: '8.0.1' }));

    try {
      expect(() =>
        assertReactRouterRscSupport({
          pluginName: 'test-plugin',
          resolvePackagePath: specifier =>
            specifier === 'react-router/package.json'
              ? packageJsonPath
              : undefined,
        })
      ).toThrow('requires `react-server-dom-rspack/client.browser`');
    } finally {
      rmSync(tempDir, { force: true, recursive: true });
    }
  });
});
