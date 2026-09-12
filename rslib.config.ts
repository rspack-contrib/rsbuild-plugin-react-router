import {
  cjsConfig,
  commonExternals,
  esmConfig,
} from '@rsbuild/config/rslib.config.js';
import { defineConfig } from '@rslib/core';
const config = defineConfig({
  lib: [
    {
      ...esmConfig,
      source: {
        entry: {
          index: './src/index.ts',
          'route-module-transform-loader':
            './src/route-module-transform-loader.ts',
          'rsc-route-transform-loader': './src/rsc-route-transform-loader.ts',
          'server-build-worker': './src/server-build-worker.ts',
          'templates/entry.server': './src/templates/entry.server.tsx',
          'templates/entry.client': './src/templates/entry.client.tsx',
          'templates/entry.rsc': './src/templates/entry.rsc.tsx',
          'templates/entry.rsc.client': './src/templates/entry.rsc.client.tsx',
          'templates/entry.rsc.ssr': './src/templates/entry.rsc.ssr.tsx',
        },
      },
    },
    {
      ...cjsConfig,
      source: {
        entry: {
          index: './src/index.ts',
          'rsc-route-transform-loader': './src/rsc-route-transform-loader.ts',
          'templates/entry.server': './src/templates/entry.server.tsx',
          'templates/entry.client': './src/templates/entry.client.tsx',
        },
      },
    },
  ],
  tools: {
    rspack: {
      externals: [
        ...commonExternals,
        'user-routes',
        /^virtual\/react-router\//,
        /^virtual:react-router\//,
        /^react-router-dom/,
        /^react-router/,
        /^@react-router/,
        'react',
        /^react-dom/,
        /^react-server-dom-rspack/,
        /^rsbuild-plugin-rsc/,
      ],
    },
  },
});
export default config;
