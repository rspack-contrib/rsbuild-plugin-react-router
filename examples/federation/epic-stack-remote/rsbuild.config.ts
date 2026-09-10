import { ModuleFederationPlugin } from '@module-federation/enhanced/rspack'
import { defineConfig } from '@rsbuild/core'
import { pluginReact } from '@rsbuild/plugin-react'
import  { type Compiler } from '@rspack/core'
import { pluginReactRouter } from 'rsbuild-plugin-react-router'

import 'react-router'

const DEV_PORT = Number(process.env.PORT || 3007)
const REMOTE_ORIGIN =
	process.env.REMOTE_ORIGIN ?? `http://localhost:${DEV_PORT}`
const REMOTE_ASSET_PREFIX = REMOTE_ORIGIN.endsWith('/')
	? REMOTE_ORIGIN
	: `${REMOTE_ORIGIN}/`

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
	"./utils/misc": "./app/utils/misc",
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
	experiments: {
		asyncStartup: true,
	},
	dts: false,
	// The host loads the container from this fixed URL, so name it explicitly.
	// Every other browser chunk keeps Rsbuild's content hash.
	filename: 'static/js/remote.js',
	library: {
		type: 'module'
	},
}

// Node-specific federation config
const nodeFederationConfig = {
	...commonFederationConfig,
	experiments: {
		asyncStartup: true,
	},
	dts: false,
	// The server build is published under the client build's `static/` (see the
	// plugin's federation copy), so the host loads this container from
	// `<origin>/static/static/js/remote.js`.
	filename: 'static/js/remote.js',
	library: {
		type: 'commonjs-module'
	},
	runtimePlugins: [
		'@module-federation/node/runtimePlugin'
	],
	// see https://github.com/module-federation/core/blob/main/packages/manifest/src/ManifestManager.ts#L106
	manifest:{
		additionalData:(additionalDataOptions)=>{
			const { stats, } =additionalDataOptions;
			stats.metaData.ssrRemoteEntry = stats.metaData.remoteEntry;
			return stats;
		}
	}
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
			output: {
				// The browser runtime derives its asset base from the script it was
				// loaded from, so the same build works wherever the host fetches the
				// container from. Server-rendered URLs keep REMOTE_ASSET_PREFIX.
				assetPrefix: 'auto',
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
			assetPrefix: REMOTE_ASSET_PREFIX,
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
		port: DEV_PORT,
	},
	output: {
		assetPrefix: REMOTE_ASSET_PREFIX,
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
