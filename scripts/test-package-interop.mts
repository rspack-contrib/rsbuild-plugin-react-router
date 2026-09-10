import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const require = createRequire(import.meta.url);
const execFileAsync = promisify(execFile);
const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const build = {
  entry: { module: { default: () => new Response() } },
  routes: {},
  assets: { routes: {}, version: 'interop' },
  assetsBuildDirectory: '/app/build/client',
  basename: '/',
  future: {},
  isSpaMode: false,
  prerender: [],
  publicPath: '/',
  routeDiscovery: { mode: 'initial' },
  ssr: true,
};

const collect = hooks => hook => hooks.push(hook);
const noop = () => undefined;
const invoke = hook => (typeof hook === 'function' ? hook() : hook.handler?.());

const loadEntryPoints = async () => {
  const esm = await import('../dist/index.js');
  const commonjs = require('../dist/index.cjs');
  return [esm, commonjs];
};

const verifyRegistration = async (writer, reader) => {
  const starts = [];
  const closeBuilds = [];
  const closeDevServers = [];
  const exits = [];
  const api = {
    context: { action: 'dev', rootPath: process.cwd() },
    logger: { info: noop, warn: noop, error: noop },
    getNormalizedConfig: () => ({}),
    modifyRsbuildConfig: noop,
    modifyEnvironmentConfig: noop,
    onBeforeBuild: noop,
    onBeforeCreateCompiler: noop,
    modifyBundlerChain: noop,
    modifyRspackConfig: noop,
    isPluginExists: () => false,
    onBeforeStartDevServer: collect(starts),
    onAfterStartDevServer: noop,
    onCloseDevServer: collect(closeDevServers),
    onCloseBuild: collect(closeBuilds),
    onExit: collect(exits),
    onAfterEnvironmentCompile: noop,
    onAfterBuild: noop,
    processAssets: noop,
    transform: noop,
    onBeforeDevCompile: noop,
    onAfterCreateCompiler: noop,
    onAfterDevCompile: noop,
  };
  await writer.pluginReactRouter({ customServer: true }).setup(api);

  const startHook = starts.find(hook => hook.order === 'pre');
  const closeHook = closeDevServers.find(hook => hook.order === 'pre');
  assert(startHook, 'Expected a pre dev-server start hook');
  assert(closeHook, 'Expected a pre dev-server close hook');
  assert.equal(closeBuilds.length, 1);
  assert.deepEqual(closeBuilds, exits);
  assert.deepEqual(closeDevServers, [closeBuilds[0], closeHook]);
  const start = startHook.handler;
  const server = {
    close: async () => undefined,
    environments: { node: { loadBundle: async () => build } },
    sockWrite: noop,
  };
  await start({ environments: {}, server });

  const pending = reader.loadReactRouterServerBuild(server);
  await Promise.all([...closeBuilds, ...closeDevServers, ...exits].map(invoke));
  await assert.rejects(pending, /closed before a React Router build was ready/);
  await assert.rejects(
    reader.loadReactRouterServerBuild(server),
    /not registered/
  );
};

const verifyPackIncludesOriginalSource = async () => {
  const { stdout } = await execFileAsync(
    'npm',
    ['pack', '--dry-run', '--json'],
    {
      cwd: packageRoot,
    }
  );
  const [pack] = JSON.parse(stdout);
  const files = new Set(pack.files.map(file => file.path));

  assert(
    files.has('src/index.ts'),
    'Expected npm package to include src/index.ts'
  );
  assert(
    files.has('src/templates/entry.client.tsx'),
    'Expected npm package to include source templates'
  );
};

const verifyEffectFreeRuntimeOutputs = () => {
  const dist = new URL('../dist/', import.meta.url);
  const pending = [
    'route-module-transform-loader.js',
    'rsc-route-transform-loader.js',
    'rsc-route-transform-loader.cjs',
    'templates/entry.client.js',
    'templates/entry.client.cjs',
    'templates/entry.rsc.client.js',
  ].map(file => new URL(file, dist));
  const visited = new Set<string>();

  while (pending.length > 0) {
    const file = pending.pop();
    if (!file || visited.has(file.href)) continue;
    visited.add(file.href);
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /["']effect(?:\/|["'])/);
    for (const [, specifier] of source.matchAll(
      /(?:\bfrom\s*|\b(?:import|require)\s*\(?\s*)["'](\.{1,2}\/[^"']+)["']/g
    )) {
      const dependency = new URL(specifier, file);
      assert(dependency.href.startsWith(dist.href));
      pending.push(dependency);
    }
  }
};

const verifyRscPublicSurface = (esm, commonjs) => {
  assert.equal(typeof esm.pluginReactRouterRSC, 'function');
  assert.equal(typeof commonjs.pluginReactRouterRSC, 'function');
  assert.match(
    readFileSync(new URL('../dist/index.js', import.meta.url), 'utf8'),
    /rsc-route-transform-loader\.js/
  );
  assert.match(
    readFileSync(new URL('../dist/index.cjs', import.meta.url), 'utf8'),
    /rsc-route-transform-loader\.cjs/
  );

  for (const specifier of [
    'rsbuild-plugin-react-router/templates/entry.rsc',
    'rsbuild-plugin-react-router/templates/entry.rsc.client',
    'rsbuild-plugin-react-router/templates/entry.rsc.ssr',
  ]) {
    const resolved = import.meta.resolve(specifier);
    assert.match(
      resolved,
      /\/dist\/templates\/entry\.rsc(?:\.client|\.ssr)?\.js$/
    );
    assert.throws(
      () => require.resolve(specifier),
      error => {
        const code =
          error && typeof error === 'object' && 'code' in error
            ? error.code
            : undefined;
        return (
          code === 'ERR_PACKAGE_PATH_NOT_EXPORTED' ||
          code === 'ERR_PACKAGE_IMPORT_NOT_DEFINED'
        );
      }
    );
  }
};

const main = async () => {
  const [esm, commonjs] = await loadEntryPoints();
  await verifyPackIncludesOriginalSource();
  verifyEffectFreeRuntimeOutputs();
  verifyRscPublicSurface(esm, commonjs);
  process.chdir(
    fileURLToPath(new URL('../tests/fixtures/dev-runtime/', import.meta.url))
  );
  await verifyRegistration(esm, commonjs);
  await verifyRegistration(commonjs, esm);
  assert.deepEqual(
    await esm.resolveReactRouterServerBuild({ default: build }),
    build
  );
  assert.deepEqual(
    await commonjs.resolveReactRouterServerBuild({ default: build }),
    build
  );
  console.log('ESM and CommonJS package entrypoints share runtime state.');
};

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
