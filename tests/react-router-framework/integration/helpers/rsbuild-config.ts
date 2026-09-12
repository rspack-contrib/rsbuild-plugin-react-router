import dedent from "dedent";

import type { TemplateName } from "./templates.js";

type RsbuildConfigServerArgs = {
  port: number;
};

type RsbuildConfigBuildArgs = {
  assetsInlineLimit?: number;
  assetsDir?: string;
  cssCodeSplit?: boolean;
};

type RsbuildConfigBaseArgs = {
  templateName?: TemplateName;
  /** Rspack persistent cache, kept inside the fixture (fixtures share the template's node_modules). */
  buildCache?: boolean;
  base?: string;
  defineNodeEnv?: boolean;
  envPrefixes?: string[];
  mdx?: boolean;
  svgr?: boolean;
  tailwind?: boolean;
  sass?: boolean;
  less?: boolean;
  vanillaExtract?: boolean;
};

type RsbuildConfigArgs = (
  | RsbuildConfigServerArgs
  | { [K in keyof RsbuildConfigServerArgs]?: never }
) &
  RsbuildConfigBuildArgs &
  RsbuildConfigBaseArgs;

const configSection = (name: string, entries: string[]) =>
  entries.length > 0
    ? [`${name}: {`, ...entries.map((entry) => `  ${entry}`), `},`]
    : [];

const CSS_CODE_SPLIT_NOTE =
  '// Vite "build.cssCodeSplit: false" is not mapped: rsbuild always extracts CSS and these fixtures only assert that styles are applied.';

/**
 * Emits rsbuild.config.ts contents for test fixtures.
 *
 * Vite -> rsbuild option mappings used by the corpus:
 * - `base` -> `output.assetPrefix` + `dev.assetPrefix`. We intentionally do
 *   not use rsbuild `server.base` (React Router's `basename` handles route
 *   prefixing and the plugin's dev SSR middleware serves all paths).
 * - `server.port` + `strictPort` -> `server.port` + `server.strictPort`
 * - `build.assetsInlineLimit` -> `output.dataUriLimit`
 * - `build.assetsDir` -> `output.distPath.assets`
 * - vanilla-extract Vite plugin -> `@vanilla-extract/webpack-plugin` via
 *   `tools.rspack`
 * - MDX rollup plugin -> `@rsbuild/plugin-mdx`
 * - vite-plugin-svgr -> `@rsbuild/plugin-svgr` (`.svg?react` / `.svg?url`)
 * - Tailwind PostCSS plugin -> `@rsbuild/plugin-tailwindcss` (Tailwind v4)
 * - Sass Vite plugin -> `@rsbuild/plugin-sass`
 * - Less Vite plugin -> `@rsbuild/plugin-less`
 *
 * Intentionally unmapped Vite options:
 * - `server.hmr.port`: rsbuild serves the HMR websocket on the dev server port
 * - `server.fs.allow`: Vite-only static file serving restriction
 * - `build.cssCodeSplit`: see CSS_CODE_SPLIT_NOTE
 * - `vite-tsconfig-paths`: rsbuild resolves tsconfig `paths` natively
 */
export const rsbuildConfig = {
  // Emits the `server` section of an rsbuild config object literal so tests
  // can compose their own rsbuild.config.ts strings.
  server: async ({ port }: RsbuildConfigServerArgs) => {
    return dedent`
      server: {
        port: ${port},
        strictPort: true,
      },
    `;
  },
  // Emits the `output` section of an rsbuild config object literal.
  build: ({
    assetsInlineLimit,
    assetsDir,
    cssCodeSplit,
  }: RsbuildConfigBuildArgs = {}) => {
    return [
      ...configSection("output", [
        ...(assetsInlineLimit !== undefined
          ? [`dataUriLimit: ${assetsInlineLimit}, // Vite: build.assetsInlineLimit`]
          : []),
        ...(assetsDir !== undefined
          ? [
              `distPath: { assets: ${JSON.stringify(assetsDir)} }, // Vite: build.assetsDir`,
            ]
          : []),
      ]),
      ...(cssCodeSplit === false ? [CSS_CODE_SPLIT_NOTE] : []),
    ].join("\n");
  },
  // Emits a complete rsbuild.config.ts.
  basic: async (args: RsbuildConfigArgs = {}) => {
    const isRsc = args.templateName?.includes("rsc") ?? false;
    const routerPlugin = isRsc ? "pluginReactRouterRSC" : "pluginReactRouter";

    const imports = [
      `import { defineConfig${args.envPrefixes ? ", loadEnv" : ""} } from "@rsbuild/core";`,
      ...(args.mdx ? [`import { pluginMdx } from "@rsbuild/plugin-mdx";`] : []),
      ...(args.svgr
        ? [`import { pluginSvgr } from "@rsbuild/plugin-svgr";`]
        : []),
      ...(args.tailwind
        ? [`import { pluginTailwindcss } from "@rsbuild/plugin-tailwindcss";`]
        : []),
      ...(args.sass
        ? [`import { pluginSass } from "@rsbuild/plugin-sass";`]
        : []),
      ...(args.less
        ? [`import { pluginLess } from "@rsbuild/plugin-less";`]
        : []),
      `import { pluginReact } from "@rsbuild/plugin-react";`,
      `import { ${routerPlugin} } from "rsbuild-plugin-react-router";`,
      ...(args.vanillaExtract
        ? [
            `import { VanillaExtractPlugin } from "@vanilla-extract/webpack-plugin";`,
          ]
        : []),
    ];

    const prelude = args.envPrefixes
      ? [
          `const { publicVars } = loadEnv({ prefixes: ${JSON.stringify(args.envPrefixes)} });`,
          "",
        ]
      : [];

    const config = [
      ...configSection("server", [
        ...(args.port !== undefined
          ? [`port: ${args.port},`, `strictPort: true,`]
          : []),
      ]),
      ...configSection("dev", [
        ...(args.base !== undefined
          ? [`assetPrefix: ${JSON.stringify(args.base)}, // Vite: base (dev)`]
          : []),
      ]),
      ...configSection("output", [
        ...(args.base !== undefined
          ? [`assetPrefix: ${JSON.stringify(args.base)}, // Vite: base`]
          : []),
        ...(args.assetsInlineLimit !== undefined
          ? [`dataUriLimit: ${args.assetsInlineLimit}, // Vite: build.assetsInlineLimit`]
          : []),
        ...(args.assetsDir !== undefined
          ? [
              `distPath: { assets: ${JSON.stringify(args.assetsDir)} }, // Vite: build.assetsDir`,
            ]
          : []),
      ]),
      ...configSection("performance", [
        ...(args.buildCache
          ? [`buildCache: { cacheDirectory: "./.rspack-cache" },`]
          : []),
      ]),
      ...configSection("source", [
        ...(args.defineNodeEnv || args.envPrefixes
          ? [
              `define: {`,
              ...(args.defineNodeEnv
                ? [
                    `  "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV ?? "development"),`,
                  ]
                : []),
              ...(args.envPrefixes ? [`  ...publicVars,`] : []),
              `},`,
            ]
          : []),
      ]),
      ...(args.vanillaExtract
        ? [
            `// vanilla-extract: debug identifiers + sideEffects disabled for .css.ts imports.`,
            `tools: {`,
            `  rspack: {`,
            `    plugins: [new VanillaExtractPlugin({ identifiers: "debug" })],`,
            `    optimization: { sideEffects: false },`,
            `  },`,
            `},`,
          ]
        : []),
      ...(args.cssCodeSplit === false ? [CSS_CODE_SPLIT_NOTE] : []),
      `plugins: [pluginReact(), ${args.mdx ? "pluginMdx(), " : ""}${args.svgr ? "pluginSvgr(), " : ""}${args.tailwind ? "pluginTailwindcss(), " : ""}${args.sass ? "pluginSass(), " : ""}${args.less ? "pluginLess(), " : ""}${routerPlugin}()],`,
    ];

    return [
      ...imports,
      "",
      ...prelude,
      "export default defineConfig({",
      ...config.map((line) => `  ${line}`),
      "});",
      "",
    ].join("\n");
  },
};
