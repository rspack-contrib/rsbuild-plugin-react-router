---
'rsbuild-plugin-react-router': patch
---

Fix two `ssr: false` / prerender build issues:

- `rsbuild build` no longer hangs when the app's server graph opens a ref'd handle at module scope (for example a `BroadcastChannel`). Build-time rendering (SPA-mode `index.html` and prerendering, classic and RSC) now evaluates the server bundle in a worker thread that is terminated once rendering is done, instead of importing it into the build process (#135).
- With `performance.buildCache` enabled, a warm build no longer renders `index.html` against the previous build's asset URLs. The server-manifest module now declares a file dependency on the captured manifest, so Rspack's persistent cache invalidates it whenever the web build's asset names change (#136).
