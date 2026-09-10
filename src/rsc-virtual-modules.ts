import { relative, resolve } from 'pathe';
import type { Config } from './react-router-config.js';
import type { Route } from './types.js';
import { combineURLs, normalizeAssetPrefix } from './plugin-utils.js';
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
  'bootstrap-scripts',
  'server-manifest',
] as const;

type RscVirtualModulesOptions = {
  allowedActionOrigins: string[] | undefined;
  appDirectory: string;
  basename: string;
  buildDirectory: string;
  isBuild: boolean;
  /** Resolved web `output.distPath.js` segment, e.g. `static/js`. */
  jsDistPath: string;
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
  jsDistPath,
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
  // Fallback only: the compiled browser entry name is not deterministic once
  // the user (or Rsbuild's production default) content-hashes `filename.js`.
  const fallbackBootstrapScript = combineURLs(
    serverPublicPath,
    `${jsDistPath}/index.js`
  );

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
    // The rspack RSC manifest records the compiled browser entry files (like
    // Next's `buildManifest` or the Vite plugin's `loadBootstrapScriptContent`),
    // already prefixed with the prefix it reports in `moduleLoading.prefix`, so
    // hashed entry filenames resolve without any naming contract. When that
    // applied prefix differs from the server prefix (the browser compiler is on
    // `'auto'`, which rspack records as `/`), swap it for the server prefix
    // instead of stacking a second one; the list and its order are preserved.
    'virtual/react-router/unstable_rsc/bootstrap-scripts': `const manifest = __webpack_require__.rscM;
const entryJsFiles = manifest?.entryJsFiles;
const appliedPrefix = manifest?.moduleLoading?.prefix;
const serverPrefix = ${JSON.stringify(serverPublicPath)};
export default !entryJsFiles?.length
  ? ${JSON.stringify([fallbackBootstrapScript])}
  : appliedPrefix && appliedPrefix !== serverPrefix
    ? entryJsFiles.map(file =>
        file.startsWith(appliedPrefix)
          ? serverPrefix + file.slice(appliedPrefix.length)
          : file
      )
    : entryJsFiles;
`,
    'virtual/react-router/unstable_rsc/server-manifest': `export default function getServerManifest() {
  return __webpack_require__.rscM?.serverManifest;
}
`,
    'virtual/react-router/rsc-internal-client': createRscInternalClientModule(),
  };
};
