# rsbuild-plugin-react-router

## 0.7.1

### Patch Changes

- 2b04e53: Make Module Federation work through async startup (#132), and tighten RSC
  asset handling.
  - Federation (browser): route-module entries are made async so Rspack awaits
    the Module Federation startup before exporting (`(await startup).default`);
    React Router's synchronous `import * as route from ".../root.js"` and
    `import()` of split route chunks now see real exports and hydration
    proceeds. Each federation container gets its own runtime chunk, so importing
    a container no longer runs the remote app's own share-scope consumes before
    the host initializes the share scope (which produced a second React).
  - Federation (server): server code splitting is async-only (enforced at the
    final `tools.rspack` boundary, including cache groups such as Rsbuild's
    `single-vendor` preset; a disabled `splitChunks` is kept), so the CommonJS
    server build has no initial chunk dependencies. `@module-federation/node`
    replaces Rspack's chunk loader with one that tracks loaded chunks privately,
    which left Rspack's startup gate unsatisfied and made the awaited server
    build resolve to `undefined`. `experiments.asyncStartup` stays enforced on
    every compiler and shared dependencies stay non-eager.
  - RSC: the manifest prefix alignment also rebases relative references produced
    by an empty browser `assetPrefix` (absolute and protocol-relative URLs are
    left alone). RSC filename validation now checks the emitted web output:
    JavaScript-emitting chunks are identified from compilation metadata and
    their emitted script names (entry or async template, including function
    templates and `tools.rspack` overrides) must end in `.js`.
  - Federation example: CORS is scoped to the remote's asset handlers instead of
    the whole application.

## 0.7.0

### Minor Changes

- b1c0d55: Respect user web output settings instead of overriding them (#129, #130).
  - The plugin no longer forces web `output.filename.js` to `[name].js`, and no
    longer sets the classic-mode async `chunkFilename`. Rsbuild owns every browser
    JavaScript filename: production entries get Rsbuild's default content hash,
    and `output.filename.js` (string or function), `output.filenameHash`,
    `output.distPath.jsAsync`, and query-hash filenames such as
    `[name].js?v=[contenthash:8]` are honored. The browser manifest classifies
    emitted assets by pathname and keeps the full emitted reference, so any
    naming scheme resolves to the right route module.
  - The plugin no longer copies the root `assetPrefix` onto the web compiler's
    `output.publicPath`. Rsbuild derives `publicPath` from the web environment's
    `output.assetPrefix`, so `environments.web.output.assetPrefix: 'auto'` (or a
    per-environment CDN prefix) reaches the browser runtime and async CSS resolves
    relative to the loaded script. The server build and browser manifest still
    need an absolute prefix: they use the web environment's prefix when it is
    usable and otherwise fall back to the root prefix, so
    `output.assetPrefix: 'https://cdn.example.com/'` + web `'auto'` keeps emitting
    CDN URLs from the server (`'auto'` is only folded to `/` when nothing else is
    configured).
  - Rspack `output` defaults for the web and node environments are applied via
    `modifyRspackConfig`, which Rsbuild runs before the user's `tools.rspack`, so
    both the object and function forms of `tools.rspack` override plugin output
    defaults such as the server `chunkFilename`.
  - Module Federation remotes: the browser container chunk is no longer implicitly
    emitted as `<name>.js`. Set `filename` on `ModuleFederationPlugin` (for
    example `filename: 'static/js/remote.js'`) so the host keeps a stable
    container URL; the federation example does this now.
  - RSC framework mode reads the browser bootstrap scripts from the rspack RSC
    manifest (`entryJsFiles`, in order) instead of assuming `index.js`. When the
    browser compiler is on `'auto'`, rspack records `/` as the manifest prefix;
    the plugin aligns the manifest once, in place, with the server prefix, so
    bootstrap scripts, route stylesheets, client-reference stylesheets, and
    Flight's preload prefix agree. An empty `entryJsFiles` is an explicit error,
    and RSC mode rejects web `output.filename.js` values that do not end in
    `.js` (rspack's collector drops them) at config time.
  - Browser-manifest assets are classified by pathname (`.js`/`.mjs`/`.cjs`, with
    or without a query); a chunk whose metadata names no script fails the build
    instead of guessing a filename.
  - `onBeforeCreateCompiler` no longer asks Rsbuild for the `web` environment's
    normalized config, which throws when the build is narrowed to other
    environments (`--environment node`).
  - Federation example: the remote now serves its assets with CORS, names both
    containers explicitly, publishes its server async chunks where the Node
    federation runtime resolves them, and puts the browser compiler on `'auto'`.

## 0.6.6

### Patch Changes

- 3ecef1b: Honor a user-provided `app/entry.ssr.tsx` in RSC framework mode. The RSC entry
  template imported its own SSR template directly, so an override was placed in
  the SSR layer while the template kept being compiled as React Server code and
  failed the build on `react-dom/server`. The template now imports the resolved
  SSR entry through `virtual/react-router/unstable_rsc/entry-ssr`.

## 0.6.5

### Patch Changes

- 93c1333: Hash the browser manifest version with sha256 instead of md5, which is
  unavailable on FIPS-enabled machines and made builds fail there. The version
  is a short content digest, so existing deployments only see the manifest file
  name change once.

## 0.6.4

### Patch Changes

- 12b5302: Fail the build with a clear error when two different route files sanitize to
  the same rspack entry name (for example `../shared/x.tsx` and `__/shared/x.tsx`)
  instead of letting one route silently serve the other's module. Routes that
  intentionally share a file still share one entry. `buildEnd` hooks now receive
  the fully resolved `future` flags, including defaults, rather than only the
  flags the user or a preset set explicitly.

## 0.6.3

### Patch Changes

- 97aae44: Resolve React Router 8.3's `future.unstable_enableNodeReadableStream` flag
  (default `false`) so the resolved config handed to presets and `buildEnd`
  matches the current `@react-router/dev` shape. The plugin ships its own server
  entry, so the flag is passed through without changing plugin behavior.

## 0.6.2

### Patch Changes

- b5b0e7b: Shrink classic-mode production browser output. Production builds now mangle
  export names (`optimization.mangleExports: 'size'`), drop exports nothing
  imports across the whole graph (`optimization.usedExports: 'global'`), and name
  async chunks `static/js/async/[id]-[contenthash:16].js`. Classic mode resolves
  route modules through the browser manifest by chunk, so export names are not
  part of its runtime contract. RSC builds are unchanged and keep every export
  name because Flight resolves client references by name. Development builds are
  unchanged. To keep readable export names in a classic production build, set
  `optimization.mangleExports` and `optimization.usedExports` back in the
  function form of `tools.rspack`, which runs after plugin defaults are merged.

## 0.6.1

### Patch Changes

- cabf4b9: Derive route entry names from the route file instead of the route id. A route
  table built with `relative()` resolves route files to absolute paths, so React
  Router relativizes `file` but leaves `id` absolute, and the plugin used that
  opaque id as an rspack entry name. Split route module chunks were therefore
  emitted into a directory tree mirroring the developer's checkout
  (`static/js/Users/<user>/.../customers-client-loader.js`) and the browser
  manifest published those paths, leaking `$HOME` into production assets and
  making builds unreproducible across machines and CI. Entry names are now
  app-relative for both the route entry and its chunks, so a chunk lands beside
  its route, the `"/static/js//..."` double slash is gone, and an entry can no
  longer escape the JS output directory or carry a Windows drive prefix. Route
  ids are untouched: they remain the runtime contract behind
  `useRouteLoaderData(id)` and `matches[].id`. Note that route chunks for routes
  declared with an explicit `id` are renamed accordingly, which changes those
  asset URLs.
- cabf4b9: Derive the development browser manifest `version` from the manifest content
  instead of a random value per web compilation. The browser manifest asset is
  served from the latest web compilation while the server build stays pinned to
  the compilation it was committed with, so a web compilation that left the
  manifest unchanged (for example the hot data revalidation recompile after a
  server change) gave the two different versions. React Router's stale-client
  check then answered route discovery with a document reload, which could land
  mid-navigation and surface as a hydration mismatch. Equal manifests now share a
  version, and a real change still busts the browser cache through the `?v=`
  query on the development manifest URL.

## 0.6.0

### Minor Changes

- 0dd1fa8: Add React Router 8 compatibility while preserving React Router 7 behavior.
  The plugin now supports stable React Router 8 config fields, resolves
  prerender data requests for the installed React Router major version, supports
  React Router RSC mode, analyzes transformed MDX route modules for manifest
  generation, preserves Flight client-reference exports and names in production,
  supports React Router 8.3 stale-client detection in production builds,
  avoids initial RSC client-loader hydration races, coalesces client and server
  RSC hot updates while keeping client-only state mounted without revalidating
  ordinary lazy compilations, restarts the development server reliably when
  route topology changes, and includes React Router 8/RSC examples plus framework
  integration coverage. Route watcher startup no longer interrupts early
  development hot updates with a server restart, and temporarily invalid route
  configs no longer tear down the active HMR compiler.
- ae222a3: Keep React Router `handle`, `links`, `meta`, and `shouldRevalidate` exports
  functional when their RSC route module imports CSS. Require Rsbuild 2.2 and keep
  the exports in the regular route chunk, relying on Rspack 2.2's direct client
  reference emission.

### Patch Changes

- c62ae2e: Share one scoped Effect runtime across each plugin setup so route watchers,
  lazy-compilation prewarm work, type generation, prerendering, and other
  background resources shut down in a deterministic, idempotent order. Effect
  remains excluded from emitted transform loaders and browser/runtime templates.
- f49cf0f: Generate route client entry imports with relative requests so build output and
  content hashes stay stable when the same project is built from different paths.
- 0dd1fa8: Stream server-first route CSS during RSC render. CSS imported in the RSC
  layer never flows through the client manifest's `<Links>`, so it was
  previously dropped. Modules exporting server components are now marked with
  the `'use server-entry'` directive so rspack's RSC runtime records
  `entryCssFiles`, which the server route entry wrapper streams as
  precedence-tagged stylesheet links, fixing missing styles and
  flash-of-unstyled-content for server-component routes.
- df208f5: Run every merged `buildEnd` hook before propagating the first failure.

## 0.5.0

### Minor Changes

- 10a996b: Keep route transforms inline by default instead of automatically creating
  worker threads for large apps. Explicit `parallelRouteTransform` values now use
  Rspack's parallel loader (`true` selects Rspack's default worker count and a
  positive integer caps the worker count) while preserving composed source maps
  and per-worker performance logs.

  Recognize both legacy and enhanced Rspack Module Federation plugins when
  enabling `experiments.asyncStartup`.

## 0.4.1

### Patch Changes

- dde2a2d: Stop forcing development output to disk so `dev.writeToDisk: false` and Rsbuild's in-memory default are preserved.

## 0.4.0

### Minor Changes

- 2c155f2: Add state-preserving Hot Module Replacement for route modules in development: route updates now apply React Refresh registration and in-place route patching instead of triggering a full page reload. Server code changes also trigger hot data revalidation, so loader data refreshes without a reload. This degrades gracefully to the previous full-reload behavior when `@rsbuild/plugin-react` isn't present or Fast Refresh is disabled.

### Patch Changes

- 2c155f2: Align the Fast Refresh registration backfill with react-refresh's own
  component-detection rules so `memo`/`forwardRef` components in pre-lowered
  (MDX) routes register for HMR. Multi-declarator lists, curried arrows, and
  require/import interop callees no longer produce false registrations.
- 96ed301: Export `ReactRouterRsbuildConfig`, the plugin's typed `react-router.config.*`
  shape (React Router's `Config` plus plugin-supported options such as
  `splitRouteModules`), so projects no longer need to import types from
  `@react-router/dev/config` or hand-roll intersections. `@react-router/dev`
  is declared as an optional peer dependency since the exported config and
  route types resolve from it; this is not a breaking change — nothing new is
  required at install or runtime.
- 35a2036: Prerender fixes: root route data now flows through the legacy handler path,
  and the dynamic/splat prerender warning strips the leading slash only for
  top-level dynamic segments so nested paths are reported correctly.

## 0.3.1

### Patch Changes

- fde856e: Improve development startup performance with guarded lazy compilation enabled by default, configurable route transform workers, unstable opt-in lazy-compilation prewarming, and leaner dev build orchestration.
- 18fb279: Migrate the dev middleware hook from `dev.setupMiddlewares` to `server.setup`.
- 9e95ea0: Serve the React Router SPA shell during `rsbuild dev` when `ssr` is disabled.
- a512cc2: Preserve React Router manifest assets when Rspack natural chunk or module ids make direct chunk lookup incomplete.
- 4aff046: Fix route export analysis for valid TypeScript route modules that Yuku cannot parse, and preserve literal browser manifest replacement values containing `$`.

## 0.3.0

### Minor Changes

- 95874ff: Keep development SSR requests on the last successfully evaluated atomic set of
  React Router server entries and their paired web manifests, and expose
  `loadReactRouterServerBuild` so custom servers use the same last-good pair.
  Expose `resolveReactRouterServerBuild` to normalize ESM and CommonJS production
  server modules through the same validated build boundary.
  Preserve `serverBundles` through config normalization and publish every
  configured bundle atomically with its exact filtered manifest.
  This does not snapshot deferred server chunks, make emitted client assets
  atomic, or delay Rsbuild's WebSocket success notification.
- 31e5bf5: Expose a plugin-level `lazyCompilation` option that keeps React Router hydration
  modules eager while preserving user lazy compilation filters.

### Patch Changes

- 95874ff: Improve route analysis and route chunking performance for larger applications, with benchmark tooling to track build overhead.
- 9352787: Reload the dev server when local helper modules imported by React Router config change.
- 95874ff: Keep React Router hydration entries compatible with Rsbuild lazy compilation when `entries: true` is enabled.
- 3f6db5c: Preserve mixed asset query semantics for `?url&raw` and `?url&inline` requests.
- c4b6d8b: Simplify the README configuration docs and stabilize `parallelRouteTransform` so `true` forces the default worker count, a positive integer sets the worker count, and `false` disables worker-thread route transforms.
- 95874ff: Preserve route topology declaration order during development so reordering route
  entries is detected as a topology change.
- 95874ff: Harden route module transforms and development route watching so source maps,
  server/client-only modules, and route topology restarts behave consistently.
- 61f451e: Support React Router's stable `prerender.concurrency` config while preserving
  the existing `unstable_concurrency` fallback.
- 0287c14: Support React Router's stable `subResourceIntegrity` config and keep it in sync
  with `future.unstable_subResourceIntegrity` when merging presets and user
  configuration.
- 95874ff: Avoid duplicate startup route topology scans and tighten development watcher
  lifecycle handling for route additions and removals.

## 0.2.0

### Minor Changes

- fc02b96: Add support for Rsbuild 2 and update the Rsbuild/Rspack toolchain.

## 0.1.1

### Patch Changes

- f6691e1: Enable Rspack HMR for ESM server outputs by not forcing `dev.hmr=false` in the React Router plugin.
- 4b933d0: Use `@remix-run/node-fetch-server` for the built-in dev server middleware to reduce direct reliance on `@mjackson/node-fetch-server`.

## 0.1.0

### Minor Changes

- 3c6d368: Bring Rsbuild plugin behavior closer to React Router framework behavior.
  - Add React Router config resolution + validations/warnings for closer framework parity
  - Add split route modules (route chunk entrypoints) including enforce mode validation
  - Improve `.client` module stubbing on the server (including `export *` re-exports)
  - Improve manifest generation: stable fingerprinted build manifests, bundle-specific server manifests, and optional Subresource Integrity (`future.unstable_subResourceIntegrity`)
  - Improve Module Federation support by relying on Rspack `experiments.asyncStartup` (without overriding explicit CommonJS server output)

## 0.0.5

### Patch Changes

- 797b401: Fix: Correctly expose routeDiscovery configuration for React Router v7 in Rspack builds.

## 0.0.4

### Patch Changes

- 88b052d: do not set target when output is esm

## 0.0.3

### Patch Changes

- 8928f7b: search for routes file with any extention
- 8928f7b: support multiple extentions for routes file, like js,ts,jsx etc

## 0.0.2

### Patch Changes

- 53722e4: remove logs from module proxy

## 0.0.1

### Patch Changes

- 2aa8f3e: Support React Router
