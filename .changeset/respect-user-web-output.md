---
'rsbuild-plugin-react-router': patch
---

Respect user web output settings instead of overriding them (#129, #130).

- The plugin no longer forces web `output.filename.js` to `[name].js`. Production
  browser entries now get Rsbuild's default content hash
  (`[name].[contenthash:10].js`), and a user `output.filename.js` (string or
  function) is honored. When the user configures `filename.js`, the plugin's
  classic-mode async `chunkFilename` default also steps aside so Rsbuild can
  derive the async chunk name from the user's scheme.
- The plugin no longer copies the root `assetPrefix` onto the web compiler's
  `output.publicPath`. Rsbuild derives `publicPath` from the environment's
  `output.assetPrefix`, so `environments.web.output.assetPrefix: 'auto'` (or a
  per-environment CDN prefix) now reaches the browser runtime, and async CSS
  resolves from the script origin as expected. The server build and browser
  manifest keep an absolute prefix, resolved from the web environment
  (falling back to the root), with `'auto'` normalized to `/`.
- Rspack `output` defaults for the web and node environments are applied via
  `modifyRspackConfig`, which Rsbuild runs before the user's `tools.rspack`, so
  both the object and function forms of `tools.rspack` can override plugin
  output defaults such as `chunkFilename`.
- RSC framework mode reads the browser bootstrap script from the rspack RSC
  manifest (`entryJsFiles`) at runtime instead of assuming `index.js`, so hashed
  entry filenames work there too.
