import type { RsbuildPluginAPI, Rspack } from '@rsbuild/core';
import { ensureFederationAsyncStartup } from './federation.js';

/**
 * Rspack `output` policy for the web and node environments, in two tiers:
 *
 * 1. Overridable defaults, registered through `modifyRspackConfig`. Rsbuild
 *    runs the user's `tools.rspack` (object or function form) after this hook,
 *    so user output settings such as `chunkFilename` take precedence
 *    (#129, #130). Neither `filename` nor `publicPath` is set here: Rsbuild
 *    derives them from `output.filename`/`output.filenameHash`/`output.distPath`
 *    and the environment's `output.assetPrefix`, which keeps `'auto'` intact.
 * 2. Enforced invariants, registered through a `tools.rspack` function that
 *    runs after the user's own `tools.rspack`: the server library type must
 *    match the server module format, and federation builds need async startup.
 */
export const registerReactRouterEnvironmentOutput = ({
  api,
  federation,
  resolvedServerOutput,
  webOutput,
}: {
  api: RsbuildPluginAPI;
  federation: boolean | undefined;
  resolvedServerOutput: 'commonjs' | 'module';
  webOutput: NonNullable<Rspack.Configuration['output']>;
}): void => {
  const nodeChunkLoading =
    resolvedServerOutput === 'module'
      ? 'import'
      : federation
        ? 'async-node'
        : 'require';

  api.modifyRspackConfig((rspackConfig, { environment, mergeConfig }) => {
    if (environment.name === 'web') {
      return mergeConfig(rspackConfig, {
        output: {
          ...webOutput,
          ...(federation ? { chunkLoading: 'import' } : {}),
        },
      });
    }
    if (environment.name === 'node') {
      return mergeConfig(rspackConfig, {
        output: {
          chunkFormat: resolvedServerOutput,
          chunkLoading: nodeChunkLoading,
          devtoolModuleFilenameTemplate: '[absolute-resource-path]',
          devtoolFallbackModuleFilenameTemplate:
            '[absolute-resource-path]?[hash]',
          workerChunkLoading: nodeChunkLoading,
          wasmLoading: 'fetch',
          module: resolvedServerOutput === 'module',
          chunkFilename: 'static/js/async/[name].js',
        },
      });
    }
    return rspackConfig;
  });

  api.modifyEnvironmentConfig(
    async (config, { name, mergeEnvironmentConfig }) => {
      if (name !== 'web' && name !== 'node') {
        return config;
      }

      return mergeEnvironmentConfig(config, {
        tools: {
          rspack: rspackConfig => {
            if (federation) {
              ensureFederationAsyncStartup(rspackConfig);
            }

            if (name === 'node') {
              const output = rspackConfig.output;
              if (output) {
                const library = output.library;
                const libraryOptions =
                  library &&
                  typeof library === 'object' &&
                  !Array.isArray(library)
                    ? library
                    : {};
                rspackConfig.output = {
                  ...output,
                  library: {
                    ...libraryOptions,
                    type:
                      resolvedServerOutput === 'module'
                        ? 'module'
                        : 'commonjs2',
                  },
                };
              }
            }

            return rspackConfig;
          },
        },
      });
    }
  );
};
