import { describe, expect, it } from '@rstest/core';
import { generate, parse } from '../src/yuku';
import {
  combineURLs,
  createRouteId,
  generateWithProps,
  normalizeAssetPrefix,
  resolveEffectiveAssetPrefix,
  transformRoute,
} from '../src/plugin-utils';

const transformRouteCode = (code: string) => {
  const ast = parse(code, { sourceType: 'module' });
  transformRoute(ast);
  return generate(ast).code;
};

describe('plugin-utils', () => {
  describe('combineURLs', () => {
    it('should combine base and relative URLs', () => {
      expect(combineURLs('/base', 'relative')).toBe('/base/relative');
    });

    it('should handle trailing slashes on base URL', () => {
      expect(combineURLs('/base/', 'relative')).toBe('/base/relative');
    });

    it('should handle leading slashes on relative URL', () => {
      expect(combineURLs('/base', '/relative')).toBe('/base/relative');
    });

    it('should handle both trailing and leading slashes', () => {
      expect(combineURLs('/base/', '/relative')).toBe('/base/relative');
    });

    it('should return base URL when relative is empty', () => {
      expect(combineURLs('/base', '')).toBe('/base');
    });

    it('should handle multiple slashes', () => {
      expect(combineURLs('/base///', '///relative')).toBe('/base/relative');
    });
  });

  describe('createRouteId', () => {
    it('should create route ID from file path', () => {
      expect(createRouteId('routes/home.test.tsx')).toBe('routes/home.test');
    });

    it('should normalize path separators', () => {
      const result = createRouteId('routes\\home.tsx');
      expect(result).toBe('routes/home');
    });

    it('should handle nested routes', () => {
      expect(createRouteId('routes/users/$userId.tsx')).toBe(
        'routes/users/$userId'
      );
    });
  });

  describe('generateWithProps', () => {
    it('should generate withComponentProps HOC', () => {
      const result = generateWithProps();
      expect(result).toContain('withComponentProps');
      expect(result).toContain('UNSAFE_withComponentProps');
    });

    it('should generate withHydrateFallbackProps HOC', () => {
      const result = generateWithProps();
      expect(result).toContain('withHydrateFallbackProps');
    });

    it('should generate withErrorBoundaryProps HOC', () => {
      const result = generateWithProps();
      expect(result).toContain('withErrorBoundaryProps');
      expect(result).toContain('UNSAFE_withErrorBoundaryProps');
    });

    it('should import from react-router', () => {
      const result = generateWithProps();
      expect(result).toContain('from "react-router"');
    });
  });

  describe('normalizeAssetPrefix', () => {
    it('should default to "/" when undefined', () => {
      expect(normalizeAssetPrefix()).toBe('/');
    });

    it('should normalize "auto" to "/"', () => {
      expect(normalizeAssetPrefix('auto')).toBe('/');
    });

    it('should ensure trailing slash', () => {
      expect(normalizeAssetPrefix('/assets')).toBe('/assets/');
    });

    it('should keep trailing slash intact', () => {
      expect(normalizeAssetPrefix('/assets/')).toBe('/assets/');
    });
  });

  describe('resolveEffectiveAssetPrefix', () => {
    it('uses output.assetPrefix in build mode', () => {
      expect(
        resolveEffectiveAssetPrefix({
          dev: { assetPrefix: '/dev' },
          output: { assetPrefix: '/cdn' },
          isBuild: true,
        })
      ).toBe('/cdn/');
    });

    it('ignores dev.assetPrefix in build mode', () => {
      expect(
        resolveEffectiveAssetPrefix({
          dev: { assetPrefix: '/dev' },
          output: {},
          isBuild: true,
        })
      ).toBe('/');
    });

    it('uses dev.assetPrefix in dev mode', () => {
      expect(
        resolveEffectiveAssetPrefix({
          dev: { assetPrefix: '/app' },
          output: { assetPrefix: '/cdn' },
          isBuild: false,
        })
      ).toBe('/app/');
    });

    it('falls back to output.assetPrefix in dev mode when dev.assetPrefix is unset', () => {
      expect(
        resolveEffectiveAssetPrefix({
          dev: {},
          output: { assetPrefix: '/cdn' },
          isBuild: false,
        })
      ).toBe('/cdn/');
    });

    it('normalizes a boolean dev.assetPrefix to the root prefix', () => {
      expect(
        resolveEffectiveAssetPrefix({
          dev: { assetPrefix: false },
          output: {},
          isBuild: false,
        })
      ).toBe('/');
    });

    it('mirrors Rsbuild server.base defaulting (dev.assetPrefix already resolved)', () => {
      // Rsbuild copies `server.base` into `dev.assetPrefix` during config
      // normalization, so the resolver only needs to read the resolved field.
      expect(
        resolveEffectiveAssetPrefix({
          dev: { assetPrefix: '/base' },
          output: { assetPrefix: '/base' },
          isBuild: false,
        })
      ).toBe('/base/');
    });

    it('defaults to root prefix when nothing is configured', () => {
      expect(
        resolveEffectiveAssetPrefix({ dev: {}, output: {}, isBuild: false })
      ).toBe('/');
    });

    // The web environment is the primary source; the root config is the
    // fallback, consulted before 'auto' is normalized away (#130).
    it('prefers the web environment prefix over the root prefix', () => {
      expect(
        resolveEffectiveAssetPrefix(
          { output: { assetPrefix: 'https://cdn.example.com/' }, isBuild: true },
          { output: { assetPrefix: '/root/' } }
        )
      ).toBe('https://cdn.example.com/');
    });

    it('falls back to the root prefix when the web prefix is auto', () => {
      expect(
        resolveEffectiveAssetPrefix(
          { output: { assetPrefix: 'auto' }, isBuild: true },
          { output: { assetPrefix: 'https://cdn.example.com/app' } }
        )
      ).toBe('https://cdn.example.com/app/');
      expect(
        resolveEffectiveAssetPrefix(
          { output: { assetPrefix: 'auto' }, isBuild: true },
          { output: { assetPrefix: '/app/' } }
        )
      ).toBe('/app/');
    });

    it('falls back to the root prefix when the web prefix is empty or unset', () => {
      expect(
        resolveEffectiveAssetPrefix(
          { output: { assetPrefix: '' }, isBuild: true },
          { output: { assetPrefix: '/app/' } }
        )
      ).toBe('/app/');
      expect(
        resolveEffectiveAssetPrefix(
          { output: {}, isBuild: true },
          { output: { assetPrefix: '/app/' } }
        )
      ).toBe('/app/');
    });

    it('resolves to root when web and root are both auto', () => {
      expect(
        resolveEffectiveAssetPrefix(
          { output: { assetPrefix: 'auto' }, isBuild: true },
          { output: { assetPrefix: 'auto' } }
        )
      ).toBe('/');
    });

    it('applies the fallback chain to dev.assetPrefix in dev mode', () => {
      expect(
        resolveEffectiveAssetPrefix(
          { dev: { assetPrefix: 'auto' }, output: {}, isBuild: false },
          { dev: { assetPrefix: '/dev-root/' }, output: { assetPrefix: '/cdn' } }
        )
      ).toBe('/dev-root/');
    });
  });

  describe('transformRoute', () => {
    it('preserves bundler directives while transforming routes', () => {
      const result = transformRouteCode(`
        export default function Route() {
          return import(/* webpackChunkName: "route-data" */ './data');
        }
      `);

      expect(result).toContain('webpackChunkName');
    });

    it('preserves named default class bindings', () => {
      const result = transformRouteCode(`
        export default class Route {}
        Route.displayName = 'Route';
      `);

      expect(result).toMatch(/class Route/);
      expect(result).toMatch(/export default _withComponentProps\(Route\)/);
      expect(result).toContain(`Route.displayName = 'Route'`);
    });

    it('wraps default class exports with component props', () => {
      const result = transformRouteCode(`
        export default class Route {}
      `);

      expect(result).toContain('withComponentProps');
      expect(result).toMatch(/class Route/);
      expect(result).toMatch(/export default _withComponentProps\(Route\)/);
    });

    it('wraps named class component exports', () => {
      const result = transformRouteCode(`
        export class ErrorBoundary {}
      `);

      expect(result).toContain('withErrorBoundaryProps');
      expect(result).toMatch(
        /export const ErrorBoundary = _withErrorBoundaryProps\(class ErrorBoundary/
      );
    });

    it('wraps component exports declared through export specifiers', () => {
      const result = transformRouteCode(`
        function Boundary() {
          return null;
        }
        export { Boundary as ErrorBoundary };
      `);

      expect(result).toContain('withErrorBoundaryProps');
      expect(result).toMatch(
        /const _ErrorBoundary = _withErrorBoundaryProps\(Boundary\)/
      );
      expect(result).toMatch(/export \{ _ErrorBoundary as ErrorBoundary \}/);
    });

    it('wraps component exports re-exported from another module', () => {
      const result = transformRouteCode(`
        export { Boundary as ErrorBoundary } from './boundary';
      `);

      expect(result).toMatch(
        /import \{ Boundary as _ErrorBoundarySource \} from ["']\.\/boundary["']/
      );
      expect(result).toMatch(
        /const _ErrorBoundary = _withErrorBoundaryProps\(_ErrorBoundarySource\)/
      );
      expect(result).toMatch(/export \{ _ErrorBoundary as ErrorBoundary \}/);
    });

    it('wraps default route component re-exports', () => {
      const result = transformRouteCode(`
        export { default } from './Route';
      `);

      expect(result).toContain('withComponentProps');
      expect(result).not.toContain('withdefaultProps');
      expect(result).toContain('export { _default as default }');
    });

    it('keeps directives before generated HOC imports', () => {
      const result = transformRouteCode(`
        "use client";
        function Route() {
          return null;
        }
        export { Route as default };
      `);

      expect(result.search(/['"]use client['"]/)).toBeLessThan(
        result.search(/from ['"]react-router['"]/)
      );
      expect(result).toContain(
        'UNSAFE_withComponentProps as _withComponentProps'
      );
      expect(result).toContain('withComponentProps');
      expect(result).not.toContain('withdefaultProps');
    });

    it('preserves side-effect import order before wrapped source re-exports', () => {
      const result = transformRouteCode(`
        import './setup';
        export { Boundary as ErrorBoundary } from './boundary';
      `);

      expect(result.indexOf("import './setup'")).toBeLessThan(
        result.search(
          /import\s*\{\s*Boundary as _ErrorBoundarySource\s*\}\s*from ['"]\.\/boundary['"]/
        )
      );
    });

    it('does not turn type-only exports into runtime component wrappers', () => {
      const result = transformRouteCode(`
        type Boundary = { message: string };
        export type { Boundary as ErrorBoundary };
      `);

      expect(result).not.toContain('withErrorBoundaryProps');
      expect(result).not.toContain('const _ErrorBoundary');
    });

    it('does not wrap erased default interface exports', () => {
      const result = transformRouteCode(`
        export default interface Route {
          value: string;
        }
      `);

      expect(result).not.toContain('withComponentProps');
      expect(result).toContain('export default interface Route');
    });

    it('avoids top-level generated helper name collisions', () => {
      const result = transformRouteCode(`
        const _withComponentProps = 'reserved';
        export default function Route() { return null; }
      `);

      expect(result).toContain('withComponentProps as _withComponentProps2');
      expect(result).toContain('export default _withComponentProps2');
    });

    it('does not reserve generated helper names used only in local scopes', () => {
      const result = transformRouteCode(`
        export default function Route() {
          const _withComponentProps = 'local';
          return _withComponentProps;
        }
      `);

      expect(result).toContain('withComponentProps as _withComponentProps');
      expect(result).toContain('function Route');
      expect(result).toContain('export default _withComponentProps(Route)');
      expect(result).not.toContain('_withComponentProps2');
    });

    it('does not reserve generated helper names from re-export specifiers', () => {
      const result = transformRouteCode(`
        export { foo as _withComponentProps } from './foo';
        export default function Route() { return null; }
      `);

      expect(result).toContain('withComponentProps as _withComponentProps');
      expect(result).toContain('export default _withComponentProps');
      expect(result).not.toContain('_withComponentProps2');
    });

    it('avoids top-level generated helper name collisions with enums', () => {
      const result = transformRouteCode(`
        enum _withComponentProps {
          reserved = 'reserved'
        }
        export default function Route() { return null; }
      `);

      expect(result).toContain('withComponentProps as _withComponentProps2');
      expect(result).toContain('export default _withComponentProps2(Route)');
    });
  });
});
