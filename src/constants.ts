export const PLUGIN_NAME = 'rsbuild:react-router';

export const SERVER_ONLY_ROUTE_EXPORTS = [
  'loader',
  'action',
  'headers',
] as const;

export const CLIENT_ROUTE_EXPORTS = [
  'clientAction',
  'clientLoader',
  'default',
  'ErrorBoundary',
  'handle',
  'HydrateFallback',
  'Layout',
  'links',
  'meta',
  'shouldRevalidate',
] as const;

export const NAMED_COMPONENT_EXPORTS = [
  'HydrateFallback',
  'ErrorBoundary',
] as const;

export const SERVER_EXPORTS = {
  loader: 'loader',
  action: 'action',
  headers: 'headers',
} as const;

export const CLIENT_EXPORTS = {
  clientAction: 'clientAction',
  clientLoader: 'clientLoader',
  default: 'default',
  ErrorBoundary: 'ErrorBoundary',
  handle: 'handle',
  HydrateFallback: 'HydrateFallback',
  Layout: 'Layout',
  links: 'links',
  meta: 'meta',
  shouldRevalidate: 'shouldRevalidate',
} as const;