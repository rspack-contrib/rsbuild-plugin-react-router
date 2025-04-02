// Patch for handling CJS output from the build
const app = require('./build/server/static/js/app.js');

// Export all the top-level keys needed by react-router-serve
const {
  assets,
  assetsBuildDirectory,
  basename,
  entry,
  future,
  isSpaMode,
  prerender,
  publicPath,
  routes,
  ssr
} = app;

// Export each property individually
exports.assets = assets;
exports.assetsBuildDirectory = assetsBuildDirectory;
exports.basename = basename;
exports.entry = entry;
exports.future = future;
exports.isSpaMode = isSpaMode;
exports.prerender = prerender;
exports.publicPath = publicPath;
exports.routes = routes;
exports.ssr = ssr;
