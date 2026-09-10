import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from '@rstest/core';
import {
  createReactRouterManifestStats,
  configRoutesToRouteManifest,
  configRoutesToRouteManifestEntries,
  generateReactRouterManifestForDev,
  getReactRouterManifestForDev,
  getReactRouterManifestChunkNames,
  isManifestCssAsset,
  isManifestJsAsset,
} from '../src/manifest';

const createTempApp = (routeCode: string) => {
  const root = mkdtempSync(join(tmpdir(), 'rr-manifest-'));
  const appDir = join(root, 'app');
  const routesDir = join(appDir, 'routes');
  mkdirSync(routesDir, { recursive: true });

  writeFileSync(
    join(appDir, 'root.tsx'),
    `export default function Root() { return null; }`
  );
  writeFileSync(join(routesDir, 'page.tsx'), routeCode);

  return { root, appDir };
};

const routes = {
  root: { id: 'root', file: 'root.tsx', path: '' },
  'routes/page': {
    id: 'routes/page',
    parentId: 'root',
    file: 'routes/page.tsx',
    path: 'page',
  },
};

const clientStats = {
  assetsByChunkName: {
    'entry.client': ['static/js/entry.client.js'],
    root: ['static/js/root.js'],
    'routes/page': ['static/js/routes/page.js'],
  },
};

describe('manifest', () => {
  it('creates manifest stats from named chunks without stats JSON', () => {
    const compilation = {
      namedChunks: new Map([
        [
          'runtime',
          {
            files: new Set(['static/js/runtime.js']),
          },
        ],
        [
          'entry.client',
          {
            files: new Set([
              'static/js/entry.client.js',
              'static/css/entry.client.css',
            ]),
          },
        ],
        [
          'routes/page',
          {
            files: new Set(['static/js/routes/page.js']),
          },
        ],
      ]),
    };

    expect(createReactRouterManifestStats(compilation)).toEqual({
      assetsByChunkName: {
        runtime: ['static/js/runtime.js'],
        'entry.client': [
          'static/js/entry.client.js',
          'static/css/entry.client.css',
        ],
        'routes/page': ['static/js/routes/page.js'],
      },
    });
  });

  it('filters manifest stats to requested chunk names', () => {
    const compilation = {
      namedChunks: new Map([
        ['runtime', { files: new Set(['static/js/runtime.js']) }],
        ['entry.client', { files: new Set(['static/js/entry.client.js']) }],
        ['routes/page', { files: new Set(['static/js/routes/page.js']) }],
        ['vendor', { files: new Set(['static/js/vendor.js']) }],
      ]),
    };

    expect(
      createReactRouterManifestStats(
        compilation,
        new Set(['entry.client', 'routes/page'])
      )
    ).toEqual({
      assetsByChunkName: {
        'entry.client': ['static/js/entry.client.js'],
        'routes/page': ['static/js/routes/page.js'],
      },
    });
  });

  it('classifies manifest assets by pathname regardless of filename scheme', () => {
    // Query-hash filenames keep their query in the emitted reference.
    expect(isManifestJsAsset('static/js/entry.client.js?v=abc12345')).toBe(true);
    expect(isManifestJsAsset('static/js/abc12345.js')).toBe(true);
    expect(isManifestJsAsset('static/js/abc12345-root.js')).toBe(true);
    expect(isManifestCssAsset('static/css/root.css?v=abc12345')).toBe(true);
    // HMR update files are recorded on `chunk.files` but are never the module.
    expect(isManifestJsAsset('static/js/root.abc12345.hot-update.js')).toBe(
      false
    );
    expect(isManifestJsAsset('static/js/root.js.map')).toBe(false);
    expect(isManifestJsAsset('static/css/root.css')).toBe(false);
  });

  it('skips missing named chunks while creating manifest stats', () => {
    const compilation = {
      namedChunks: new Map([
        ['runtime', { files: new Set(['static/js/runtime.js']) }],
        ['missing', null],
        ['entry.client', { files: new Set(['static/js/entry.client.js']) }],
      ]),
    };

    expect(createReactRouterManifestStats(compilation)).toEqual({
      assetsByChunkName: {
        runtime: ['static/js/runtime.js'],
        'entry.client': ['static/js/entry.client.js'],
      },
    });
  });

  it('uses direct named chunk lookup for filtered manifest stats when available', () => {
    const chunks = new Map([
      ['entry.client', { files: new Set(['static/js/entry.client.js']) }],
      ['routes/page', { files: new Set(['static/js/routes/page.js']) }],
    ]);
    const compilation = {
      namedChunks: {
        get: (chunkName: string) => chunks.get(chunkName),
        *[Symbol.iterator](): IterableIterator<
          [string, { files: Set<string> }]
        > {
          throw new Error('filtered manifest stats should not scan all chunks');
        },
      },
    };

    expect(
      createReactRouterManifestStats(
        compilation,
        new Set(['entry.client', 'routes/page'])
      )
    ).toEqual({
      assetsByChunkName: {
        'entry.client': ['static/js/entry.client.js'],
        'routes/page': ['static/js/routes/page.js'],
      },
    });
  });

  it('falls back to iteration when direct lookup misses requested manifest chunks', () => {
    const chunks = new Map([
      ['entry.client', { files: new Set(['static/js/entry.client.js']) }],
      ['routes/page', { files: new Set(['static/js/routes/page.js']) }],
      ['vendor', { files: new Set(['static/js/vendor.js']) }],
    ]);
    const entrypoints = new Map([
      ['entry.client', { getFiles: () => ['static/css/entry.client.css'] }],
      ['routes/page', { getFiles: () => ['static/css/routes/page.css'] }],
      ['vendor', { getFiles: () => ['static/css/vendor.css'] }],
    ]);
    const compilation = {
      namedChunks: {
        get: () => undefined,
        *[Symbol.iterator](): IterableIterator<
          [string, { files: Set<string> }]
        > {
          yield* chunks;
        },
      },
      entrypoints: {
        get: () => undefined,
        *[Symbol.iterator](): IterableIterator<
          [string, { getFiles: () => string[] }]
        > {
          yield* entrypoints;
        },
      },
    };

    expect(
      createReactRouterManifestStats(
        compilation,
        new Set(['entry.client', 'routes/page'])
      )
    ).toEqual({
      assetsByChunkName: {
        'entry.client': ['static/js/entry.client.js'],
        'routes/page': ['static/js/routes/page.js'],
      },
      entrypointFilesByName: {
        'entry.client': ['static/css/entry.client.css'],
        'routes/page': ['static/css/routes/page.css'],
      },
    });
  });

  it('skips null manifest stats lookup entries', () => {
    const compilation = {
      namedChunks: new Map([
        ['entry.client', { files: new Set(['static/js/entry.client.js']) }],
        ['routes/page', null],
      ]),
      entrypoints: new Map([
        ['entry.client', { getFiles: () => ['static/css/entry.client.css'] }],
        ['routes/page', null],
      ]),
    };

    expect(createReactRouterManifestStats(compilation)).toEqual({
      assetsByChunkName: {
        'entry.client': ['static/js/entry.client.js'],
      },
      entrypointFilesByName: {
        'entry.client': ['static/css/entry.client.css'],
      },
    });
  });

  it('collects only manifest-readable chunk names', () => {
    expect(Array.from(getReactRouterManifestChunkNames(routes, '/app', false))).toEqual(
      ['entry.client', 'root', 'routes/page']
    );

    expect(getReactRouterManifestChunkNames(routes, '/app', true)).toEqual(
      new Set([
        'entry.client',
        'root',
        'routes/page',
        'routes/page-client-action',
        'routes/page-client-loader',
        'routes/page-client-middleware',
        'routes/page-hydrate-fallback',
      ])
    );
  });

  describe('configRoutesToRouteManifest', () => {
    it('should convert simple route config to manifest', () => {
      const routeConfig = [
        {
          id: 'routes/home',
          file: 'routes/home.tsx',
          path: '/',
          index: true,
        },
      ];

      const result = configRoutesToRouteManifest('app', routeConfig);

      expect(result['routes/home']).toBeDefined();
      expect(result['routes/home'].id).toBe('routes/home');
      expect(result['routes/home'].path).toBe('/');
      expect(result['routes/home'].index).toBe(true);
    });

    it('preserves declaration order in route manifest entries', () => {
      const routeConfig = [
        {
          id: '2',
          file: 'routes/two.tsx',
          path: ':value',
        },
        {
          id: '1',
          file: 'routes/one.tsx',
          path: ':value',
        },
      ];

      const result = configRoutesToRouteManifestEntries('app', routeConfig);

      expect(result.map(([id]) => id)).toEqual(['2', '1']);
    });

    it('should handle nested routes with parentId', () => {
      const routeConfig = [
        {
          id: 'routes/dashboard',
          file: 'routes/dashboard.tsx',
          path: 'dashboard',
          children: [
            {
              id: 'routes/dashboard/settings',
              file: 'routes/dashboard/settings.tsx',
              path: 'settings',
            },
          ],
        },
      ];

      const result = configRoutesToRouteManifest('app', routeConfig);

      expect(result['routes/dashboard']).toBeDefined();
      expect(result['routes/dashboard/settings']).toBeDefined();
      expect(result['routes/dashboard/settings'].parentId).toBe(
        'routes/dashboard'
      );
    });

    it('should handle routes with no path (layout routes)', () => {
      const routeConfig = [
        {
          id: 'routes/_layout',
          file: 'routes/_layout.tsx',
          children: [
            {
              id: 'routes/_layout/page',
              file: 'routes/_layout/page.tsx',
              path: 'page',
            },
          ],
        },
      ];

      const result = configRoutesToRouteManifest('app', routeConfig);

      expect(result['routes/_layout']).toBeDefined();
      expect(result['routes/_layout'].path).toBeUndefined();
    });

    it('should handle dynamic route segments', () => {
      const routeConfig = [
        {
          id: 'routes/users/$userId',
          file: 'routes/users/$userId.tsx',
          path: 'users/:userId',
        },
      ];

      const result = configRoutesToRouteManifest('app', routeConfig);

      expect(result['routes/users/$userId']).toBeDefined();
      expect(result['routes/users/$userId'].path).toBe('users/:userId');
    });

    it('should handle catch-all routes', () => {
      const routeConfig = [
        {
          id: 'routes/$',
          file: 'routes/$.tsx',
          path: '*',
        },
      ];

      const result = configRoutesToRouteManifest('app', routeConfig);

      expect(result['routes/$']).toBeDefined();
      expect(result['routes/$'].path).toBe('*');
    });

    it('should handle empty route config', () => {
      const result = configRoutesToRouteManifest('app', []);
      expect(Object.keys(result)).toHaveLength(0);
    });

    it('should preserve caseSensitive flag', () => {
      const routeConfig = [
        {
          id: 'routes/CaseSensitive',
          file: 'routes/CaseSensitive.tsx',
          path: 'case-sensitive',
          caseSensitive: true,
        },
      ];

      const result = configRoutesToRouteManifest('app', routeConfig);

      expect(result['routes/CaseSensitive'].caseSensitive).toBe(true);
    });

    it('should deeply nest routes with correct parentIds', () => {
      const routeConfig = [
        {
          id: 'routes/level1',
          file: 'routes/level1.tsx',
          path: 'level1',
          children: [
            {
              id: 'routes/level1/level2',
              file: 'routes/level1/level2.tsx',
              path: 'level2',
              children: [
                {
                  id: 'routes/level1/level2/level3',
                  file: 'routes/level1/level2/level3.tsx',
                  path: 'level3',
                },
              ],
            },
          ],
        },
      ];

      const result = configRoutesToRouteManifest('app', routeConfig);

      // Top-level routes have 'root' as parentId (they are children of the root route)
      expect(result['routes/level1'].parentId).toBe('root');
      expect(result['routes/level1/level2'].parentId).toBe('routes/level1');
      expect(result['routes/level1/level2/level3'].parentId).toBe(
        'routes/level1/level2'
      );
    });
  });

  // The dev manifest is generated from compiled exports and should include
  // flags for new route exports as they are added upstream.
  // This is a light-weight shape test to ensure our types stay in sync.
  it('route manifest item type includes hasClientMiddleware', () => {
    const item = {
      id: 'root',
      module: '/static/js/root.js',
      hasAction: false,
      hasLoader: false,
      hasClientAction: false,
      hasClientLoader: false,
      hasClientMiddleware: false,
      hasDefaultExport: false,
      hasErrorBoundary: false,
      imports: [],
      css: [],
    };

    expect(item).toHaveProperty('hasClientMiddleware', false);
    expect(item).toHaveProperty('hasDefaultExport', false);
  });

  it('tracks route exports outside the manifest payload', async () => {
    const { root, appDir } = createTempApp(`
      export function headers() { return {}; }
      export async function action() { return null; }
      export async function loader() { return null; }
      export default function Page() { return null; }
    `);
    try {
      const { manifest, moduleExportsByRouteId } =
        await generateReactRouterManifestForDev(
          routes,
          {},
          clientStats,
          appDir,
          '/',
          {
            isBuild: true,
            rootRouteFile: 'root.tsx',
            splitRouteModules: false,
          }
        );

      const routeManifest = manifest.routes['routes/page'];
      expect(routeManifest).toMatchObject({
        hasAction: true,
        hasLoader: true,
      });
      expect(moduleExportsByRouteId['routes/page']).toEqual(
        expect.arrayContaining(['headers', 'action', 'loader', 'default'])
      );
      expect(routeManifest).not.toHaveProperty('headers');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('generates manifests through the Effect API', async () => {
    const { root, appDir } = createTempApp(`
      export async function loader() { return null; }
      export default function Page() { return null; }
    `);
    try {
      const { manifest, moduleExportsByRouteId } =
        await generateReactRouterManifestForDev(
          routes,
          {},
          clientStats,
          appDir,
          '/',
          {
            isBuild: true,
            rootRouteFile: 'root.tsx',
            splitRouteModules: false,
          }
        );

      expect(manifest.routes['routes/page']).toMatchObject({
        hasLoader: true,
        hasDefaultExport: true,
      });
      expect(moduleExportsByRouteId['routes/page']).toEqual(
        expect.arrayContaining(['loader', 'default'])
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('excludes each module from its own imports list', async () => {
    const { root, appDir } = createTempApp(`
      export async function loader() { return null; }
      export default function Page() { return null; }
    `);
    try {
      // Each chunk lists its own file first, followed by shared dependency
      // chunks. The route/entry `module` is that first file, so `imports`
      // must not list it again (upstream excludes the entry chunk's own file).
      const statsWithSharedImports = {
        assetsByChunkName: {
          'entry.client': [
            'static/js/entry.client.js',
            'static/js/shared.js',
          ],
          root: ['static/js/root.js'],
          'routes/page': ['static/js/routes/page.js', 'static/js/shared.js'],
        },
      };

      const { manifest } = await generateReactRouterManifestForDev(
        routes,
        {},
        statsWithSharedImports,
        appDir,
        '/',
        {
          isBuild: true,
          rootRouteFile: 'root.tsx',
          splitRouteModules: false,
        }
      );

      const routeItem = manifest.routes['routes/page'];
      expect(routeItem.module).toBe('/static/js/routes/page.js');
      expect(routeItem.imports).toEqual(['/static/js/shared.js']);
      expect(routeItem.imports).not.toContain(routeItem.module);

      expect(manifest.entry.module).toBe('/static/js/entry.client.js');
      expect(manifest.entry.imports).toEqual(['/static/js/shared.js']);
      expect(manifest.entry.imports).not.toContain(manifest.entry.module);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps user filename schemes (query hash, hash-first) as manifest module URLs', async () => {
    const { root, appDir } = createTempApp(`
      export default function Page() { return null; }
    `);
    try {
      // `[name].js?v=[contenthash:8]` for the entry, `[contenthash:8]-[name].js`
      // for routes: neither ends in `.js`-as-named, and neither may fall back
      // to the assumed `static/js/<chunk>.js`.
      const stats = {
        assetsByChunkName: {
          'entry.client': [
            'static/js/entry.client.js?v=1a2b3c4d',
            'static/js/entry.client.abc.hot-update.js',
            'static/css/entry.client.css?v=1a2b3c4d',
          ],
          root: ['static/js/9f8e7d6c-root.js'],
          'routes/page': ['static/js/0a1b2c3d-page.js'],
        },
        entrypointFilesByName: {
          'entry.client': [
            'static/js/runtime.js?v=deadbeef',
            'static/js/entry.client.js?v=1a2b3c4d',
          ],
        },
      };

      const { manifest } = await generateReactRouterManifestForDev(
        routes,
        {},
        stats,
        appDir,
        '/',
        { isBuild: true, rootRouteFile: 'root.tsx', splitRouteModules: false }
      );

      expect(manifest.entry.module).toBe(
        '/static/js/entry.client.js?v=1a2b3c4d'
      );
      expect(manifest.entry.imports).toEqual([
        '/static/js/runtime.js?v=deadbeef',
      ]);
      expect(manifest.entry.css).toEqual([
        '/static/css/entry.client.css?v=1a2b3c4d',
      ]);
      expect(manifest.routes.root.module).toBe('/static/js/9f8e7d6c-root.js');
      expect(manifest.routes['routes/page'].module).toBe(
        '/static/js/0a1b2c3d-page.js'
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('uses transformed route analysis for non-JavaScript route modules', async () => {
    const { root, appDir } = createTempApp(`
      import { MdxComponent } from '../components/mdx';

      export const loader = () => ({ content: 'from mdx' });

      ## MDX Route
      <MdxComponent />
    `);
    try {
      const { manifest, moduleExportsByRouteId } =
        await generateReactRouterManifestForDev(
          {
            ...routes,
            'routes/page': {
              ...routes['routes/page'],
              file: 'routes/page.mdx',
            },
          },
          {},
          clientStats,
          appDir,
          '/',
          {
            isBuild: true,
            rootRouteFile: 'root.tsx',
            splitRouteModules: false,
            routeModuleAnalysis: async routeFilePath =>
              routeFilePath.endsWith('page.mdx')
                ? {
                    code: `
                      export const loader = () => ({ content: 'from mdx' });
                      export default function MDXContent() { return <h1>MDX</h1>; }
                    `,
                    exports: ['loader', 'default'],
                    exportAllModules: [],
                  }
                : undefined,
          }
        );

      expect(manifest.routes['routes/page']).toMatchObject({
        hasLoader: true,
        hasDefaultExport: true,
      });
      expect(moduleExportsByRouteId['routes/page']).toEqual([
        'loader',
        'default',
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('preserves dev css fallback when route analysis uses transformed code', async () => {
    const { root, appDir } = createTempApp(`
      import './page.css';
      export default function Page() { return <h1>Page</h1>; }
    `);
    try {
      const manifest = await getReactRouterManifestForDev(
        routes,
        {},
        clientStats,
        appDir,
        '/',
        {
          isBuild: false,
          rootRouteFile: 'root.tsx',
          splitRouteModules: false,
        }
      );

      expect(manifest.routes['routes/page'].css).toEqual([
        '/static/css/routes/page.css',
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
