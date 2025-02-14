import { createRsbuild, loadConfig } from '@rsbuild/core'
import 'dotenv/config'

async function startServer() {
  const config = await loadConfig()
  const rsbuild = await createRsbuild({
    rsbuildConfig: config.content,
  })
  const devServer = await rsbuild.createDevServer()

  // Load the bundle first to get createApp
  if (!devServer.environments?.node) {
    throw new Error('Node environment not found in dev server')
  }

  const bundle = await devServer.environments.node.loadBundle('app')
  const { createApp } = bundle
  const app = await createApp(devServer)

  devServer.connectWebSocket({ server: app })
}

void startServer().catch(console.error)
