import { vi } from 'vitest';

// Mock the file system
vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
}));

// Mock jiti
vi.mock('jiti', () => ({
  createJiti: () => ({
    import: vi.fn().mockImplementation((path) => {
      if (path.includes('routes.ts')) {
        return Promise.resolve([
          {
            id: 'root',
            file: 'root.tsx',
            children: [
              {
                id: 'routes/index',
                file: 'routes/index.tsx',
                index: true,
              },
            ],
          },
        ]);
      }
      return Promise.resolve({});
    }),
  }),
}));

// Mock webpack sources
const mockRawSource = vi.fn().mockImplementation((content) => ({
  source: () => content,
  size: () => content.length,
}));

// Mock the @scripts/test-helper module
vi.mock('@scripts/test-helper', () => ({
  createStubRsbuild: vi.fn().mockImplementation(async ({ rsbuildConfig = {} } = {}) => ({
    addPlugins: vi.fn(),
    unwrapConfig: vi.fn().mockResolvedValue({
      dev: {
        hmr: false,
        liveReload: true,
        writeToDisk: true,
        setupMiddlewares: [],
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
            { constructor: { name: 'RspackVirtualModulePlugin' } },
          ],
        },
      },
      transforms: [
        { resourceQuery: /react-router-route/ },
      ],
    }),
    processAssets: vi.fn(),
    onBeforeStartDevServer: vi.fn(),
    onBeforeBuild: vi.fn(),
    modifyRsbuildConfig: vi.fn(),
    onAfterEnvironmentCompile: vi.fn(),
    modifyEnvironmentConfig: vi.fn(),
    transform: vi.fn(),
    context: {
      rootPath: '/Users/bytedance/dev/rsbuild-plugin-react-router',
    },
    compiler: {
      webpack: {
        sources: {
          RawSource: mockRawSource,
        },
      },
    },
  })),
})); 