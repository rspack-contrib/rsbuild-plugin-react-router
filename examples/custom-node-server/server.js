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
        const bundle = /** @type {import("./server/index.js")} */ (
          await devServer.environments.node.loadBundle('app')
        );
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
        await /** @type {any} */(serverBundle.default).app(req, res, next);
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
