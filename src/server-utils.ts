import { resolve } from 'pathe';
import type { ServerBuild } from 'react-router';
import { resolveServerBuildModule } from './server-build-resolution.js';
import type { Route } from './types.js';

/**
 * Generates the server build template string.
 *
 * Note: Federation mode used to require async `import()` wrappers for entrypoints.
 * With Rspack/@module-federation support for `experiments.asyncStartup`, the
 * server build can always use static imports.
 */
interface ServerBuildOptions {
  entryServerPath: string;
  assetsBuildDirectory: string;
  basename: string;
  appDirectory: string;
  ssr: boolean;
  isSpaMode: boolean;
  future?: unknown;
  allowedActionOrigins?: string[];
  prerender?: string[];
  publicPath?: string;
  serverManifestId?: string;
  routeDiscovery:
    | {
        mode: 'lazy';
        manifestPath?: string;
      }
    | {
        mode: 'initial';
      }
    | undefined;
}

/**
 * Generates the server build module content
 * @param routes The route manifest
 * @param options Build options
 * @returns The generated module content as a string
 */
export function generateServerBuild(
  routes: Record<string, Route>,
  options: ServerBuildOptions
): string {
  const manifestId =
    options.serverManifestId ?? 'virtual/react-router/server-manifest';
  const routeEntries = Object.entries(routes);
  return `
    import * as entryServer from ${JSON.stringify(options.entryServerPath)};
    ${routeEntries
      .map(([, route], index) => {
        if (options.isSpaMode && route.id !== 'root') {
          return `const route${index} = { default: () => null };`;
        }
        return `import * as route${index} from ${JSON.stringify(
          resolve(options.appDirectory, route.file)
        )};`;
      })
      .join('\n')}
        
    export { default as assets } from ${JSON.stringify(manifestId)};
    export const assetsBuildDirectory = ${JSON.stringify(
      options.assetsBuildDirectory
    )};
    export const basename = ${JSON.stringify(options.basename)};
    export const future = ${JSON.stringify(options.future ?? {})};
    export const isSpaMode = ${options.isSpaMode};
    export const ssr = ${options.ssr};
    export const routeDiscovery = ${JSON.stringify(options.routeDiscovery)};
    export const prerender = ${JSON.stringify(options.prerender ?? [])};
    export const publicPath = ${JSON.stringify(options.publicPath ?? '/')};
    export const entry = { module: entryServer };
    export const allowedActionOrigins = ${JSON.stringify(options.allowedActionOrigins)};
    export var routes = {};
    ${routeEntries
      .map(([key, route], index) => {
        return `routes[${JSON.stringify(key)}] = {
          id: ${JSON.stringify(route.id)},
          parentId: ${JSON.stringify(route.parentId)},
          path: ${JSON.stringify(route.path)},
          index: ${JSON.stringify(route.index)},
          caseSensitive: ${JSON.stringify(route.caseSensitive)},
          module: route${index}
        };`;
      })
      .join('\n    ')}
  `;
}

export function resolveReactRouterServerBuild(
  buildModule: unknown
): Promise<ServerBuild> {
  return resolveServerBuildModule(buildModule, 'Imported module');
}
