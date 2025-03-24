import { resolve } from 'pathe';
import type { Route } from './types.js';

/**
 * Generates the server build template string with async dynamic imports for federation mode
 */
function generateAsyncTemplate(
  routes: Record<string, Route>,
  options: {
    entryServerPath: string;
    assetsBuildDirectory: string;
    basename: string;
    appDirectory: string;
    ssr: boolean;
  }
): string {
  return `
    // Create a module cache to store the dynamically imported module
    let entryServerModule = null;
    
    // Function to ensure the module is loaded
    const ensureEntryServerLoaded = async () => {
      if (!entryServerModule) {
        entryServerModule = await import(${JSON.stringify(options.entryServerPath)});
      }
      return entryServerModule;
    };

    // Helper function to create async handlers
    const createAsyncHandler = (exportName) => {
      return async (...args) => {
        const module = await ensureEntryServerLoaded();
        const handler = module[exportName];
        return typeof handler === 'function' ? handler(...args) : handler;
      };
    };

    // Helper function to create sync handlers
    const createSyncHandler = (exportName) => {
      return (...args) => {
        if (!entryServerModule) {
          throw new Error('Entry server module not loaded yet. Call an async method first or await ensureEntryServerLoaded()');
        }
        
        const handler = entryServerModule[exportName];
        return typeof handler === 'function' ? handler(...args) : handler;
      };
    };

    // Create a proxy for the entryServer exports
    const entryServer = new Proxy({}, {
      get: (target, prop) => {
      
      console.log(prop);
        if (entryServerModule) {
          return entryServerModule[prop];
        }
        
        if (prop === 'handleDataRequest' || prop === 'handleRequest' || prop === 'default') {
          return createAsyncHandler(prop);
        }
        
        return entryServerModule[prop];
      }
    });

    // Preload the entry server module
    ensureEntryServerLoaded().catch(console.error);
    
    ${Object.keys(routes)
      .map((key, index) => {
        const route = routes[key];
        return `import * as route${index} from ${JSON.stringify(
          `${resolve(options.appDirectory, route.file)}?react-router-route`
        )};`;
      })
      .join('\n')}
    
    export { default as assets } from "virtual/react-router/server-manifest";
    export const assetsBuildDirectory = ${JSON.stringify(
      options.assetsBuildDirectory
    )};
    export const basename = ${JSON.stringify(options.basename)};
    export const future = ${JSON.stringify({})};
    export const isSpaMode = ${!options.ssr};
    export const ssr = ${options.ssr};
    export const publicPath = "/";
    export const prerender = [];
    export const entry = { module: entryServer };
    export const routes = {
      ${Object.keys(routes)
        .map((key, index) => {
          const route = routes[key];
          return `${JSON.stringify(key)}: {
            id: ${JSON.stringify(route.id)},
            parentId: ${JSON.stringify(route.parentId)},
            path: ${JSON.stringify(route.path)},
            index: ${JSON.stringify(route.index)},
            caseSensitive: ${JSON.stringify(route.caseSensitive)},
            module: route${index}
          }
            `;
        })
        .join(',\n  ')}
    };
  `;
}

/**
 * Generates the server build template string with static imports for non-federation mode
 */
function generateStaticTemplate(
  routes: Record<string, Route>,
  options: {
    entryServerPath: string;
    assetsBuildDirectory: string;
    basename: string;
    appDirectory: string;
    ssr: boolean;
  }
): string {
  return `
    import * as entryServer from ${JSON.stringify(options.entryServerPath)};
    ${Object.keys(routes)
      .map((key, index) => {
        const route = routes[key];
        return `import * as route${index} from ${JSON.stringify(
          `${resolve(options.appDirectory, route.file)}?react-router-route`
        )};`;
      })
      .join('\n')}
        
    export { default as assets } from "virtual/react-router/server-manifest";
    export const assetsBuildDirectory = ${JSON.stringify(
      options.assetsBuildDirectory
    )};
    export const basename = ${JSON.stringify(options.basename)};
    export const future = ${JSON.stringify({})};
    export const isSpaMode = ${!options.ssr};
    export const ssr = ${options.ssr};
    export const prerender = [];
    export const publicPath = "/";
    export const entry = { module: entryServer };
    export const routes = {
      ${Object.keys(routes)
        .map((key, index) => {
          const route = routes[key];
          return `${JSON.stringify(key)}: {
            id: ${JSON.stringify(route.id)},
            parentId: ${JSON.stringify(route.parentId)},
            path: ${JSON.stringify(route.path)},
            index: ${JSON.stringify(route.index)},
            caseSensitive: ${JSON.stringify(route.caseSensitive)},
            module: route${index}
          }
            `;
        })
        .join(',\n  ')}
    };
  `;
}

/**
 * Generates the server build module content
 * @param routes The route manifest
 * @param options Build options
 * @returns The generated module content as a string
 */
function generateServerBuild(
  routes: Record<string, Route>,
  options: {
    entryServerPath: string;
    assetsBuildDirectory: string;
    basename: string;
    appDirectory: string;
    ssr: boolean;
    federation?: boolean;
  }
): string {
  return options.federation
    ? generateAsyncTemplate(routes, options)
    : generateStaticTemplate(routes, options);
}

export { generateServerBuild };
