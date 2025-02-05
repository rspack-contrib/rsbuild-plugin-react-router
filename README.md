# @rsbuild/plugin-react-router

<p align="center">
  <a href="https://rsbuild.dev" target="blank"><img src="https://github.com/web-infra-dev/rsbuild/assets/7237365/84abc13e-b620-468f-a90b-dbf28e7e9427" alt="Rsbuild Logo" /></a>
</p>

A Rsbuild plugin that provides seamless integration with React Router, supporting both client-side routing and server-side rendering (SSR).

## Features

- 🚀 Zero-config setup with sensible defaults
- 🔄 Automatic route generation from file system
- 🖥️ Server-Side Rendering (SSR) support
- 📱 Client-side navigation
- 🛠️ TypeScript support out of the box
- 🔧 Customizable configuration
- 🎯 Support for route-level code splitting

## Installation

```bash
npm install @rsbuild/plugin-react-router
# or
yarn add @rsbuild/plugin-react-router
# or
pnpm add @rsbuild/plugin-react-router
```

## Usage

Add the plugin to your `rsbuild.config.ts`:

```ts
import { defineConfig } from '@rsbuild/core';
import { pluginReactRouter } from '@rsbuild/plugin-react-router';
import { pluginReact } from '@rsbuild/plugin-react';

export default defineConfig(() => {
  return {
    plugins: [
      pluginReactRouter({
        // Optional: Enable custom server mode
        customServer: false,
      }), 
      pluginReact()
    ],
  };
});
```

## Configuration

The plugin uses a two-part configuration system:

1. **Plugin Options** (in `rsbuild.config.ts`):
```ts
pluginReactRouter({
  /**
   * Whether to disable automatic middleware setup for custom server implementation.
   * Enable this when you want to handle server setup manually.
   * @default false
   */
  customServer?: boolean
})
```

2. **React Router Configuration** (in `react-router.config.ts`):
```ts
import type { Config } from '@react-router/dev/config';

export default {
  /**
   * Whether to enable Server-Side Rendering (SSR) support.
   * @default true
   */
  ssr: true,

  /**
   * Build directory for output files
   * @default 'build'
   */
  buildDirectory: 'dist',

  /**
   * Application source directory
   * @default 'app'
   */
  appDirectory: 'src/app',

  /**
   * Base URL path
   * @default '/'
   */
  basename: '/my-app',
} satisfies Config;
```

All configuration options are optional and will use sensible defaults if not specified.

### Default Configuration Values

If no configuration is provided, the following defaults will be used:

```ts
// Plugin defaults (rsbuild.config.ts)
{
  customServer: false
}

// Router defaults (react-router.config.ts)
{
  ssr: true,
  buildDirectory: 'build',
  appDirectory: 'app',
  basename: '/'
}
```

### Route Configuration

Routes can be defined in `app/routes.ts` using the helper functions from `@react-router/dev/routes`:

```ts
import {
  type RouteConfig,
  index,
  layout,
  prefix,
  route,
} from '@react-router/dev/routes';

export default [
  // Index route for the home page
  index('routes/home.tsx'),

  // Regular route
  route('about', 'routes/about.tsx'),

  // Nested routes with a layout
  layout('routes/docs/layout.tsx', [
    index('routes/docs/index.tsx'),
    route('getting-started', 'routes/docs/getting-started.tsx'),
    route('advanced', 'routes/docs/advanced.tsx'),
  ]),

  // Routes with dynamic segments
  ...prefix('projects', [
    index('routes/projects/index.tsx'),
    layout('routes/projects/layout.tsx', [
      route(':projectId', 'routes/projects/project.tsx'),
      route(':projectId/edit', 'routes/projects/edit.tsx'),
    ]),
  ]),
] satisfies RouteConfig;
```

The plugin provides several helper functions for defining routes:
- `index()` - Creates an index route
- `route()` - Creates a regular route with a path
- `layout()` - Creates a layout route with nested children
- `prefix()` - Adds a URL prefix to a group of routes

### Route Components

Route components support the following exports:

#### Client-side Exports
- `default` - The route component
- `ErrorBoundary` - Error boundary component
- `HydrateFallback` - Loading component during hydration
- `Layout` - Layout component
- `clientLoader` - Client-side data loading
- `clientAction` - Client-side form actions
- `handle` - Route handle
- `links` - Prefetch links
- `meta` - Route meta data
- `shouldRevalidate` - Revalidation control

#### Server-side Exports
- `loader` - Server-side data loading
- `action` - Server-side form actions
- `headers` - HTTP headers

## Custom Server Setup

The plugin supports two ways to handle server-side rendering:

1. **Default Server Setup**: By default, the plugin automatically sets up the necessary middleware for SSR.

2. **Custom Server Setup**: For more control, you can disable the automatic middleware setup by enabling custom server mode:

```ts
// rsbuild.config.ts
import { defineConfig } from '@rsbuild/core';
import { pluginReactRouter } from '@rsbuild/plugin-react-router';
import { pluginReact } from '@rsbuild/plugin-react';

export default defineConfig(() => {
  return {
    plugins: [
      pluginReactRouter({
        customServer: true
      }), 
      pluginReact()
    ],
  };
});
```

When using a custom server, you'll need to:

1. Create a server handler (`server/app.ts`):
```ts
import { createRequestHandler } from '@react-router/express';

export const app = createRequestHandler({
  build: () => import('virtual/react-router/server-build'),
  getLoadContext() {
    // Add custom context available to your loaders/actions
    return {
      // ... your custom context
    };
  },
});
```

2. Set up your server entry point (`server.js`):
```js
import { createRsbuild, loadConfig } from '@rsbuild/core';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const isDev = process.env.NODE_ENV !== 'production';

async function startServer() {
  if (isDev) {
    const config = await loadConfig();
    const rsbuild = await createRsbuild({
      rsbuildConfig: config.content,
    });
    const devServer = await rsbuild.createDevServer();
    app.use(devServer.middlewares);

    app.use(async (req, res, next) => {
      try {
        const bundle = await devServer.environments.node.loadBundle('app');
        await bundle.app(req, res, next);
      } catch (e) {
        next(e);
      }
    });

    const port = Number.parseInt(process.env.PORT || '3000', 10);
    const server = app.listen(port, () => {
      console.log(`Development server is running on http://localhost:${port}`);
      devServer.afterListen();
    });
    devServer.connectWebSocket({ server });
  } else {
    // Production mode
    app.use(express.static(path.join(__dirname, 'build/client'), {
      index: false
    }));

    // Load the server bundle
    const serverBundle = await import('./build/server/static/js/app.js');
    // Mount the server app after static file handling
    app.use(async (req, res, next) => {
      try {
        await serverBundle.default.app(req, res, next);
      } catch (e) {
        next(e);
      }
    });

    const port = Number.parseInt(process.env.PORT || '3000', 10);
    app.listen(port, () => {
      console.log(`Production server is running on http://localhost:${port}`);
    });
  }
}

startServer().catch(console.error);
```

3. Update your `package.json` scripts:
```json
{
  "scripts": {
    "dev": "node server.js",
    "build": "rsbuild build",
    "start": "NODE_ENV=production node server.js"
  }
}
```

The custom server setup allows you to:
- Add custom middleware
- Handle API routes
- Integrate with databases
- Implement custom authentication
- Add server-side caching
- And more!

## Cloudflare Workers Deployment

To deploy your React Router app to Cloudflare Workers:

1. **Configure Rsbuild** (`rsbuild.config.ts`):
```ts
import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';
import { pluginReactRouter } from '@rsbuild/plugin-react-router';

export default defineConfig({
  environments: {
    node: {
      performance: {
        chunkSplit: { strategy: 'all-in-one' },
      },
      tools: {
        rspack: {
          experiments: { outputModule: true },
          externalsType: 'module',
          output: {
            chunkFormat: 'module',
            chunkLoading: 'import',
            workerChunkLoading: 'import',
            wasmLoading: 'fetch',
            library: { type: 'module' },
            module: true,
          },
          resolve: {
            conditionNames: ['workerd', 'worker', 'browser', 'import', 'require'],
          },
        },
      },
    },
  },
  plugins: [pluginReactRouter({customServer: true}), pluginReact()],
});
```

2. **Create Worker Entry** (`server/app.ts`):
```ts
import { createRequestHandler } from 'react-router';

declare global {
  interface CloudflareEnvironment extends Env {}
  interface ImportMeta {
    env: {
      MODE: string;
    };
  }
}

declare module 'react-router' {
  export interface AppLoadContext {
    cloudflare: {
      env: CloudflareEnvironment;
      ctx: ExecutionContext;
    };
  }
}

// @ts-expect-error - virtual module provided by React Router at build time
import * as serverBuild from 'virtual/react-router/server-build';

const requestHandler = createRequestHandler(serverBuild, import.meta.env.MODE);

export default {
  fetch(request, env, ctx) {
    return requestHandler(request, {
      cloudflare: { env, ctx },
    });
  },
} satisfies ExportedHandler<CloudflareEnvironment>;
```

3. **Configure Wrangler** (`wrangler.toml`):
```toml
workers_dev = true
name = "my-react-router-worker"
compatibility_date = "2024-11-18"
main = "./build/server/static/js/app.js"
assets = { directory = "./build/client/" }

[vars]
VALUE_FROM_CLOUDFLARE = "Hello from Cloudflare"
```

4. **Update Package Scripts** (`package.json`):
```json
{
  "scripts": {
    "build": "rsbuild build",
    "deploy": "npm run build && wrangler deploy",
    "dev": "rsbuild dev",
    "start": "wrangler dev"
  },
  "dependencies": {
    "@react-router/node": "^7.1.3",
    "@react-router/serve": "^7.1.3",
    "react-router": "^7.1.3"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20241112.0",
    "@react-router/cloudflare": "^7.1.3",
    "@react-router/dev": "^7.1.3",
    "wrangler": "^3.106.0"
  }
}
```

## Development

The plugin automatically:
- Runs type generation during development and build
- Sets up development server with live reload
- Handles route-based code splitting
- Manages client and server builds

## License

MIT