export type Route = {
  id: string;
  parentId?: string;
  file: string;
  path?: string;
  index?: boolean;
  caseSensitive?: boolean;
  children?: Route[];
};

export type PluginOptions = {
  /**
   * Whether to disable automatic middleware setup for custom server implementation.
   * Use this when you want to handle server setup manually.
   * @default false
   */
  customServer?: boolean;

  /**
   * The output format for server builds.
   * When set to "module", no package.json will be emitted.
   * @default "module"
   */
  serverOutput?: 'module' | 'commonjs';

  /**
   * Federation mode configuration
   */
  federation?: boolean;
};

/**
 * Arguments passed to transform functions
 */
export type TransformArgs = {
  code: string;
  resource: string;
  resourcePath: string;
  context?: string | null;
  environment?: {
    name: string;
  };
};

export type RouteManifestItem = Omit<Route, 'file' | 'children'> & {
  module: string;
  hasAction: boolean;
  hasLoader: boolean;
  hasClientAction: boolean;
  hasClientLoader: boolean;
  hasErrorBoundary: boolean;
  imports: string[];
  css: string[];
};
