---
'rsbuild-plugin-react-router': patch
---

Respect user web output settings instead of overriding them (#129, #130).

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
  prefix rspack applied differs from the server prefix (browser compiler on
  `'auto'`), it is swapped rather than stacked.
