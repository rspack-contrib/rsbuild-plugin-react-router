import { pluginModuleFederation } from '@module-federation/rsbuild-plugin'
import { defineConfig } from '@rsbuild/core'
import { pluginReact } from '@rsbuild/plugin-react'
import { pluginReactRouter } from '@rsbuild/plugin-react-router'

import 'react-router'

export default defineConfig(() => {
	return {
		server: {
			port: process.env.PORT || 3000,
		},
		output: {
			externals: ['better-sqlite3', 'express'],
		},
		plugins: [
			pluginModuleFederation({
				name: 'remote',
				exposes: {
					'./search-bar': './app/components/search-bar',
				},
				shared: {
					'react': {
						singleton: true,
					},
					'react-dom': {
						singleton: true,
					},
				},
			}),
			pluginReactRouter({ customServer: true, serverOutput: 'commonjs' }),
			pluginReact(),
		],
	}
})
