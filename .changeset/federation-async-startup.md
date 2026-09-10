---
'rsbuild-plugin-react-router': patch
---

Make Module Federation work through async startup (#132), and tighten RSC
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
