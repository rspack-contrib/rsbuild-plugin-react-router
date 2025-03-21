import { ModuleFederationPlugin } from '@module-federation/enhanced/rspack'
import { defineConfig } from '@rsbuild/core'
import { pluginReact } from '@rsbuild/plugin-react'
import { pluginReactRouter } from '@rsbuild/plugin-react-router'
import type { Compiler } from '@rspack/core'

import 'react-router'

class RuntimePlugin {
	apply(compiler: Compiler) {
		const { RuntimeGlobals } = compiler.webpack;
		compiler.hooks.compilation.tap('CustomPlugin', compilation => {
			compiler.options.devtool = false
			compilation.hooks.runtimeModule.tap(
				'CustomPlugin',
				(module: any, chunk: any) => {
					if(module.name === "module_chunk_loading") {
						const interceptor =`
						console.log('test');
						var getModuleUrl = function() {
						console.log('Getting module URL', import.meta.url);
							return import.meta.url;
						};
						
						var importInterceptor = function(path) {
							var currentUrl = getModuleUrl();
							console.log('Importing:', path);
							console.log('From module:', currentUrl);
							return import(path);
						};\n
						`
						module.source.source = interceptor + module.source.source.replace(/import\(/g, 'importInterceptor(');
					}
				}
			);
		});
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
			tools: {
				rspack: {
					plugins: [
						new ModuleFederationPlugin({
							name: 'remote',
							library: {
								type: 'module'
							},
							shareStrategy: "loaded-first",
							runtime: false,
							exposes: {
								'./components/search-bar': './app/components/search-bar',
								'./components/user-dropdown': './app/components/user-dropdown',
								'./components/spacer': './app/components/spacer',
								'./components/toaster': './app/components/toaster',
								'./components/error-boundary': './app/components/error-boundary',
								'./components/floating-toolbar': './app/components/floating-toolbar',
								'./components/forms': './app/components/forms',
								'./components/progress-bar': './app/components/progress-bar',
							},
							shared: {
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
						})
					]
				}
			},
			plugins: []
		},
		node: {
			tools: {
				rspack: {
					plugins: [
						new ModuleFederationPlugin({
							name: 'remote',
							library: {
								type: 'commonjs-module'
							},
							dts: false,
							runtimePlugins: [
								'@module-federation/node/runtimePlugin'
							],
							runtime: false,
							exposes: {
								'./components/search-bar': './app/components/search-bar',
								'./components/user-dropdown': './app/components/user-dropdown',
								'./components/spacer': './app/components/spacer',
								'./components/toaster': './app/components/toaster',
								'./components/error-boundary': './app/components/error-boundary',
								'./components/floating-toolbar': './app/components/floating-toolbar',
								'./components/forms': './app/components/forms',
								'./components/progress-bar': './app/components/progress-bar',

							},
							shared: {
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
						})
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
