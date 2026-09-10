import { relative, resolve } from 'pathe';
import type { Config } from './react-router-config.js';
import type { Route } from './types.js';
import { normalizeAssetPrefix } from './plugin-utils.js';
import { getVirtualModuleFilePath } from './virtual-modules.js';
import {
  createRscInternalClientModule,
  createRscRouteConfig,
} from './rsc-route-config.js';

const defaultExport = (value: unknown): string =>
  `export default ${JSON.stringify(value)};`;

const RSC_VIRTUAL_ALIAS_IDS = [
  'routes',
  'route-discovery',
  'inject-hmr-runtime',
  'basename',
  'allowed-action-origins',
  'client-version',
  'react-router-serve-config',
  'manifest-prefix',
  'bootstrap-scripts',
  'server-manifest',
] as const;

type RscVirtualModulesOptions = {
  allowedActionOrigins: string[] | undefined;
  appDirectory: string;
  basename: string;
  buildDirectory: string;
  isBuild: boolean;
  outputClientPath: string;
  publicPath: string;
  routeDiscovery: Config['routeDiscovery'];
  routes: Record<string, Route>;
  ssr: boolean;
};

export const createReactRouterRscResolveAliases = (
  rootPath: string,
  options: { entrySsrPath?: string } = {}
): Record<string, string> => ({
  // The RSC entry template imports the SSR entry through this alias so a
  // user-provided `app/entry.ssr.tsx` replaces the template inside the SSR
  // layer instead of leaving the template to be compiled as server code.
  ...(options.entrySsrPath
    ? {
        'virtual:react-router/unstable_rsc/entry-ssr': options.entrySsrPath,
        'virtual/react-router/unstable_rsc/entry-ssr': options.entrySsrPath,
      }
    : {}),
  ...Object.fromEntries(
    RSC_VIRTUAL_ALIAS_IDS.flatMap(id => {
      const moduleId = `virtual/react-router/unstable_rsc/${id}`;
      const modulePath = resolve(rootPath, getVirtualModuleFilePath(moduleId));
      return [
        [`virtual:react-router/unstable_rsc/${id}`, modulePath],
        [moduleId, modulePath],
      ];
    })
  ),
  'react-router/internal/react-server-client': resolve(
    rootPath,
    getVirtualModuleFilePath('virtual/react-router/rsc-internal-client')
  ),
});

export const createReactRouterRscVirtualModules = ({
  allowedActionOrigins,
  appDirectory,
  basename,
  buildDirectory,
  isBuild,
  outputClientPath,
  publicPath,
  routeDiscovery,
  routes,
  ssr,
}: RscVirtualModulesOptions): Record<string, string> => {
  const rscAssetsBuildDirectory = relative(
    resolve(buildDirectory, 'server'),
    outputClientPath
  );
  // Absolute prefix the server must use for initial asset URLs (see
  // `resolveEffectiveAssetPrefix`); the browser compiler may itself be on
  // `'auto'`, which no server-rendered URL can express.
  const serverPublicPath = normalizeAssetPrefix(publicPath);

  return {
    'virtual/react-router/unstable_rsc/routes': createRscRouteConfig({
      appDirectory,
      routes,
    }),
    'virtual/react-router/unstable_rsc/route-discovery': defaultExport(
      ssr === false ? { mode: 'initial' } : (routeDiscovery ?? { mode: 'lazy' })
    ),
    'virtual/react-router/unstable_rsc/inject-hmr-runtime': !isBuild
      ? `if (import.meta.webpackHot) {
  // The RSC client entry owns update navigation; this boundary only self-accepts.
  import.meta.webpackHot.accept();
}`
      : '',
    'virtual/react-router/unstable_rsc/basename': defaultExport(basename),
    'virtual/react-router/unstable_rsc/allowed-action-origins':
      defaultExport(allowedActionOrigins),
    'virtual/react-router/unstable_rsc/client-version': isBuild
      ? 'export default __webpack_hash__;'
      : 'export default undefined;',
    'virtual/react-router/unstable_rsc/react-router-serve-config':
      defaultExport({
        assetsBuildDirectory: rscAssetsBuildDirectory,
        publicPath,
      }),
    // Every server-facing asset URL in the rspack RSC manifest -- bootstrap
    // `entryJsFiles`, route `entryCssFiles`, client references' `cssFiles`
    // (react-server-dom-rspack renders those as <link>s), and Flight's
    // `moduleLoading.prefix` for client-chunk preloads -- carries the browser
    // compiler's public path, recorded in `moduleLoading.prefix`. With the
    // browser compiler on `'auto'` rspack records `/`, which the server cannot
    // serve from. `__rspack_rsc_manifest__` is this same object, so aligning
    // it once, in place (arrays are mutated, not replaced, because
    // `createServerEntry` has already captured references), makes every
    // consumer agree on the server prefix without stacking a second one. The
    // aligned manifest is exported (not imported for side effects only) so a
    // `sideEffects: false` package cannot tree-shake the alignment away.
    'virtual/react-router/unstable_rsc/manifest-prefix': `const manifest = __webpack_require__.rscM;
const serverPrefix = ${JSON.stringify(serverPublicPath)};
const appliedPrefix = manifest?.moduleLoading?.prefix;
if (appliedPrefix && appliedPrefix !== serverPrefix) {
  const rewrite = url =>
    typeof url === "string" && url.startsWith(appliedPrefix)
      ? serverPrefix + url.slice(appliedPrefix.length)
      : url;
  const rewriteAll = list => {
    if (Array.isArray(list)) for (let i = 0; i < list.length; i++) list[i] = rewrite(list[i]);
  };
  manifest.moduleLoading.prefix = serverPrefix;
  rewriteAll(manifest.entryJsFiles);
  for (const files of Object.values(manifest.entryCssFiles ?? {})) rewriteAll(files);
  for (const reference of Object.values(manifest.clientManifest ?? {})) rewriteAll(reference.cssFiles);
}
export const rscManifest = manifest;
`,
    // The compiled browser entry scripts come from the manifest (like Next's
    // `buildManifest` or the Vite plugin's `loadBootstrapScriptContent`), so
    // hashed entry filenames resolve without any naming contract. The list and
    // its order are preserved. An empty list is a build problem (rspack only
    // records entry files named `*.js`); fail loudly instead of guessing a
    // filename that would render a document which cannot hydrate.
    'virtual/react-router/unstable_rsc/bootstrap-scripts': `import { rscManifest } from "virtual/react-router/unstable_rsc/manifest-prefix";
const entryJsFiles = rscManifest?.entryJsFiles;
if (!entryJsFiles?.length) {
  throw new Error(
    "[rsbuild-plugin-react-router] The rspack RSC manifest lists no browser entry script (entryJsFiles is empty), so the server cannot render bootstrap scripts. Rspack only records entry files whose name ends in \\".js\\"; web output.filename.js values with a query (for example \\"[name].js?v=[contenthash:8]\\") or another extension are not supported in RSC mode."
  );
}
export default entryJsFiles;
`,
    'virtual/react-router/unstable_rsc/server-manifest': `export default function getServerManifest() {
  return __webpack_require__.rscM?.serverManifest;
}
`,
    'virtual/react-router/rsc-internal-client': createRscInternalClientModule(),
  };
};
