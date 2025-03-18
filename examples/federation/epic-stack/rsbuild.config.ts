import { ModuleFederationPlugin } from '@module-federation/enhanced/rspack'
import { defineConfig } from '@rsbuild/core'
import { pluginReact } from '@rsbuild/plugin-react'
import { pluginReactRouter } from '@rsbuild/plugin-react-router'

import 'react-router'

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
						new ModuleFederationPlugin({
							name: 'host',
							runtime: false,
							remoteType: 'import',
							remotes: {
								remote: 'http://localhost:3001/static/js/remote.js',
							},
							shared: {
								react: {
									singleton: true,
								},
								'react/jsx-dev-runtime': {
									singleton: true,
								},
								'react/jsx-runtime': {
									singleton: true,
								},
								'react-dom': {
									singleton: true,
								},
							},
						}),
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
						new ModuleFederationPlugin({
							name: 'host',
							runtime: false,
							dts: false,
							remotes: {
								remote:
									'remote@http://localhost:3001/static/static/js/remote.js',
							},
							runtimePlugins: ['@module-federation/node/runtimePlugin'],
							shared: {
								react: {
									singleton: true,
								},
								'react/jsx-dev-runtime': {
									singleton: true,
								},
								'react/jsx-runtime': {
									singleton: true,
								},
								'react-dom': {
									singleton: true,
								},
							},
						}),
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
