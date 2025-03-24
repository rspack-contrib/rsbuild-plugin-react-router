import { ModuleFederationPlugin } from '@module-federation/enhanced/rspack'
import { defineConfig } from '@rsbuild/core'
import { pluginReact } from '@rsbuild/plugin-react'
import { pluginReactRouter } from '@rsbuild/plugin-react-router'

import 'react-router'

// Common shared dependencies for Module Federation
const sharedDependencies = {
	'react-router': {
		singleton: true,
	},
	'react-router/': {
		singleton: true,
	},
	react: {
		singleton: true,
	},
	'react/': {
		singleton: true,
	},
	'react-dom': {
		singleton: true,
	},
	'react-dom/': {
		singleton: true,
	},
}

// Common Module Federation configuration
const commonFederationConfig = {
	name: 'host',
	shareStrategy: "loaded-first" as const,
	shared: sharedDependencies,
	manifest: {
		filePath: 'static'
	},
}

// Web-specific federation config
const webFederationConfig = {
	...commonFederationConfig,
	remoteType: 'import' as const,
	remotes: {
		remote: 'http://localhost:3001/static/mf-manifest.json',
	},
}

// Node-specific federation config
const nodeFederationConfig = {
	...commonFederationConfig,
	remotes: {
		remote: 'remote@http://localhost:3001/static/static/mf-manifest.json',
	},
	runtimePlugins: ['@module-federation/node/runtimePlugin'],
}

export default defineConfig({
	dev: {
		client: {
			overlay: false,
		},
	},
	server: {
		port: Number(process.env.PORT || 3000),
	},
	output: {
		externals: ['better-sqlite3', 'express', 'ws'],
	},
	environments: {
		web: {
			source: {
				define: {
					'process.env.WEB': 'true',
				},
			},
			tools: {
				rspack: {
					plugins: [
						new ModuleFederationPlugin(webFederationConfig),
					],
				},
			},
			plugins: [],
		},
		node: {
			source: {
				define: {
					'process.env.WEB': 'false',
				},
			},
			tools: {
				rspack: {
					plugins: [
						new ModuleFederationPlugin(nodeFederationConfig),
					],
				},
			},
			plugins: [],
		},
	},
	plugins: [
		pluginReactRouter({
			customServer: true,
			serverOutput: 'commonjs',
			federation: true,
		}),
		pluginReact({
			fastRefresh: false,
			swcReactOptions: {
				refresh: false,
				development: false,
			},
			splitChunks: {
				react: false,
				router: false,
			},
			reactRefreshOptions: {
				overlay: false,
				exclude: /root/,
			},
		}),
	],
})
