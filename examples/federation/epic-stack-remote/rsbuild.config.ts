import { ModuleFederationPlugin } from '@module-federation/enhanced/rspack'
import { defineConfig } from '@rsbuild/core'
import { pluginReact } from '@rsbuild/plugin-react'
import { pluginReactRouter } from '@rsbuild/plugin-react-router'
import type { Compiler } from '@rspack/core'

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

// Common exposed components
const exposedComponents = {
	'./components/search-bar': './app/components/search-bar',
	'./components/user-dropdown': './app/components/user-dropdown',
	'./components/spacer': './app/components/spacer',
	'./components/toaster': './app/components/toaster',
	'./components/error-boundary': './app/components/error-boundary',
	'./components/floating-toolbar': './app/components/floating-toolbar',
	'./components/forms': './app/components/forms',
	'./components/progress-bar': './app/components/progress-bar',
	'./components/ui/tooltip': './app/components/ui/tooltip',
	'./components/ui/status-button': './app/components/ui/status-button',
	'./components/ui/textarea': './app/components/ui/textarea',
	'./components/ui/sonner': './app/components/ui/sonner',
	'./components/ui/label': './app/components/ui/label',
	'./components/ui/input': './app/components/ui/input',
	'./components/ui/input-otp': './app/components/ui/input-otp',
	'./components/ui/dropdown-menu': './app/components/ui/dropdown-menu',
	'./components/ui/icon': './app/components/ui/icon',
	'./components/ui/button': './app/components/ui/button',
	'./components/ui/checkbox': './app/components/ui/checkbox',
	"./utils/connections": "./app/utils/connections",
}

// Common Module Federation configuration
const commonFederationConfig = {
	name: 'remote',
	shareStrategy: "loaded-first" as const,
	runtime: undefined,
	exposes: exposedComponents,
	shared: sharedDependencies
}

// Web-specific federation config
const webFederationConfig = {
	...commonFederationConfig,
	library: {
		type: 'module'
	},
}

// Node-specific federation config
const nodeFederationConfig = {
	...commonFederationConfig,
	library: {
		type: 'commonjs-module'
	},
	runtimePlugins: [
		'@module-federation/node/runtimePlugin'
	],
}

export default defineConfig({
	dev: {
		client: {
			overlay: false,
		},
	},
	tools: {
		rspack: {
			devtool: false,
		}
	},
	environments: {
		web: {
			source: {
				define: {
					WEB: 'true'
				}
			},
			tools: {
				rspack: {
					plugins: [
						new ModuleFederationPlugin(webFederationConfig)
					]
				}
			},
			plugins: []
		},
		node: {
			output: {
				assetPrefix: 'http://localhost:3001/',
			},
			tools: {
				rspack: {
					plugins: [
						new ModuleFederationPlugin(nodeFederationConfig)
					]
				}
			},
			plugins: []
		}
	},
	server: {
		port: Number(process.env.PORT || 3000),
	},
	output: {
		assetPrefix: 'http://localhost:3001/',
		externals: ['better-sqlite3', 'express','ws'],
	},
	plugins: [
		pluginReactRouter({ customServer: true, serverOutput: 'commonjs', federation: true }),
		pluginReact({
			fastRefresh: false,
			swcReactOptions: {
				refresh: false,
				development: false
			},
			splitChunks: {
				router: false,
				react: false
			},
			reactRefreshOptions: {
				overlay: false,
				exclude: /root/,
			},
		}),
	],
})
