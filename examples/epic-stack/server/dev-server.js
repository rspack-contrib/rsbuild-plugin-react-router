import { createRsbuild, loadConfig } from '@rsbuild/core';
import * as dotenv from 'dotenv';

// Load environment variables from .env files
dotenv.config();

async function startServer() {
	if (process.env.NODE_ENV !== 'production') {
		const config = await loadConfig();
		const rsbuild = await createRsbuild({
			rsbuildConfig: config.content,
		});
		const devServer = await rsbuild.createDevServer();
		
		// Load the bundle first to get createApp
		const bundle = await devServer.environments.node.loadBundle('app');
		const app = await bundle.createApp(devServer);

		// Add the bundle loading middleware for subsequent requests
		// app.use(async (req, res, next) => {
		// 	try {
		// 		const bundle = await devServer.environments.node.loadBundle('app');
		// 		await bundle.app(req, res, next);
		// 	} catch (e) {
		// 		next(e);
		// 	}
		// });

		// const port = Number.parseInt(process.env.PORT || '3000', 10);
		// const server = app.listen(port, () => {
		// 	console.log(`Development server is running on http://localhost:${port}`);
		// 	devServer.afterListen();
		// });
		// devServer.connectWebSocket({ server });
	} else {
		await import(/* webpackIgnore: true */'../build/server/static/js/app');
	}
}

startServer().catch(console.error);
