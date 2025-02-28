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
			pluginReactRouter({ customServer: true, serverOutput: 'commonjs' }),
			pluginReact(),
		],
	}
})
