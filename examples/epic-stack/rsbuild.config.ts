import { defineConfig } from '@rsbuild/core'
import { pluginReact } from '@rsbuild/plugin-react'
import { pluginReactRouter } from 'rsbuild-plugin-react-router'
import 'react-router'

export default defineConfig(() => {
	return {
		output: {
			externals: ['better-sqlite3', 'express'],
		},
		plugins: [
			pluginReactRouter({ customServer: true, serverOutput: 'commonjs' }),
			pluginReact(),
		],
	}
})
