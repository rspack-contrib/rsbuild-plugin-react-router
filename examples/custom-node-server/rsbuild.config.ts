import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';
import { pluginReactRouter } from 'rsbuild-plugin-react-router';

export default defineConfig(() => {
  return {
    plugins: [
      pluginReactRouter({
        customServer: true,
        serverOutput: 'commonjs',
      }),
      pluginReact()
    ],
  };
});
