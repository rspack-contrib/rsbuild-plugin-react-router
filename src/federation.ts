import type { Rspack } from '@rsbuild/core';

type ModuleFederationPluginOptionsLike = {
  name?: string;
  experiments?: { asyncStartup?: boolean };
};

type ModuleFederationPluginLike = {
  name?: string;
  _options?: ModuleFederationPluginOptionsLike;
  options?: ModuleFederationPluginOptionsLike;
};

const getModuleFederationOptions = (
  plugin: unknown
): ModuleFederationPluginOptionsLike | undefined => {
  if (!plugin || typeof plugin !== 'object') {
    return undefined;
  }
  const federationPlugin = plugin as ModuleFederationPluginLike;
  if (
    federationPlugin.name !== 'ModuleFederationPlugin' &&
    federationPlugin.name !== 'RspackModuleFederationPlugin'
  ) {
    return undefined;
  }
  return federationPlugin._options ?? federationPlugin.options;
};

/**
 * The Module Federation container name(s) configured on this compiler, i.e.
 * the entry names of the remote containers it emits.
 */
export const getFederationContainerNames = (
  rspackConfig: Rspack.Configuration | undefined
): string[] =>
  (rspackConfig?.plugins ?? [])
    .map(getModuleFederationOptions)
    .map(options => options?.name)
    .filter((name): name is string => typeof name === 'string');

/**
 * Classic mode shares one runtime chunk across every browser entry so route
 * module entries share a module registry. A federation container must not
 * share it: importing the container would run the app entries' async startup
 * (share-scope consumes) before the host has initialized the share scope,
 * yielding duplicate singletons (a second React). Give containers their own
 * runtime chunk.
 */
export const isolateFederationContainerRuntime = (
  rspackConfig: Rspack.Configuration | undefined
): void => {
  const containers = new Set(getFederationContainerNames(rspackConfig));
  if (!rspackConfig || containers.size === 0) {
    return;
  }
  const current = rspackConfig.optimization?.runtimeChunk;
  const appRuntimeName =
    typeof current === 'object' && typeof current?.name === 'string'
      ? current.name
      : 'runtime';
  rspackConfig.optimization = {
    ...rspackConfig.optimization,
    runtimeChunk: {
      name: (entrypoint: { name: string }) =>
        containers.has(entrypoint.name)
          ? `runtime-${entrypoint.name}`
          : appRuntimeName,
    },
  };
};

export const ensureFederationAsyncStartup = (
  rspackConfig: Rspack.Configuration | undefined
): void => {
  if (!rspackConfig?.plugins?.length) {
    return;
  }

  for (const plugin of rspackConfig.plugins) {
    const pluginOptions = getModuleFederationOptions(plugin);
    if (!pluginOptions) {
      continue;
    }

    pluginOptions.experiments = {
      ...pluginOptions.experiments,
      asyncStartup: true,
    };
  }
};
