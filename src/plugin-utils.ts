import {
  deadCodeElimination,
  findReferencedIdentifiers,
} from 'babel-dead-code-elimination';
import { normalize } from 'pathe';
import { existsSync } from 'node:fs';
import type { Babel, NodePath, ParseResult } from './babel.js';
import { t, traverse } from './babel.js';
import { NAMED_COMPONENT_EXPORTS, JS_EXTENSIONS } from './constants.js';

export function validateDestructuredExports(
  id: Babel.ArrayPattern | Babel.ObjectPattern,
  exportsToRemove: string[]
): void {
  if (id.type === 'ArrayPattern') {
    for (const element of id.elements) {
      if (!element) {
        continue;
      }

      // [ foo ]
      if (
        element.type === 'Identifier' &&
        exportsToRemove.includes(element.name)
      ) {
        throw invalidDestructureError(element.name);
      }

      // [ ...foo ]
      if (
        element.type === 'RestElement' &&
        element.argument.type === 'Identifier' &&
        exportsToRemove.includes(element.argument.name)
      ) {
        throw invalidDestructureError(element.argument.name);
      }

      // [ [...] ]
      // [ {...} ]
      if (element.type === 'ArrayPattern' || element.type === 'ObjectPattern') {
        validateDestructuredExports(element, exportsToRemove);
      }
    }
  }

  if (id.type === 'ObjectPattern') {
    for (const property of id.properties) {
      if (!property) {
        continue;
      }

      if (
        property.type === 'ObjectProperty' &&
        property.key.type === 'Identifier'
      ) {
        // { foo }
        if (
          property.value.type === 'Identifier' &&
          exportsToRemove.includes(property.value.name)
        ) {
          throw invalidDestructureError(property.value.name);
        }

        // { foo: [...] }
        // { foo: {...} }
        if (
          property.value.type === 'ArrayPattern' ||
          property.value.type === 'ObjectPattern'
        ) {
          validateDestructuredExports(property.value, exportsToRemove);
        }
      }

      // { ...foo }
      if (
        property.type === 'RestElement' &&
        property.argument.type === 'Identifier' &&
        exportsToRemove.includes(property.argument.name)
      ) {
        throw invalidDestructureError(property.argument.name);
      }
    }
  }
}

export function invalidDestructureError(name: string): Error {
  return new Error(`Cannot remove destructured export "${name}"`);
}

export function toFunctionExpression(decl: Babel.FunctionDeclaration): any {
  return t.functionExpression(
    decl.id,
    decl.params,
    decl.body,
    decl.generator,
    decl.async
  );
}

export function combineURLs(baseURL: string, relativeURL: string): string {
  return relativeURL
    ? `${baseURL.replace(/\/+$/, '')}/${relativeURL.replace(/^\/+/, '')}`
    : baseURL;
}

export function stripFileExtension(file: string): string {
  return file.replace(/\.[^/.]+$/, '');
}

export function createRouteId(file: string): string {
  return normalize(stripFileExtension(file));
}

/**
 * Find a file with any of the supported JavaScript extensions
 * @param basePath - The base path without extension
 * @returns The file path with extension if found, or a default path
 */
export function findEntryFile(basePath: string): string {
  for (const ext of JS_EXTENSIONS) {
    const filePath = `${basePath}${ext}`;
    if (existsSync(filePath)) {
      return filePath;
    }
  }
  return `${basePath}.tsx`; // Default to .tsx if no file exists
}

export function generateWithProps() {
  return `
    import { createElement as h } from "react";
    import { useActionData, useLoaderData, useMatches, useParams, useRouteError } from "react-router";

    export function withComponentProps(Component) {
      return function Wrapped() {
        const props = {
          params: useParams(),
          loaderData: useLoaderData(),
          actionData: useActionData(),
          matches: useMatches(),
        };
        return h(Component, props);
      };
    }

    export function withHydrateFallbackProps(HydrateFallback) {
      return function Wrapped() {
        const props = {
          params: useParams(),
        };
        return h(HydrateFallback, props);
      };
    }

    export function withErrorBoundaryProps(ErrorBoundary) {
      return function Wrapped() {
        const props = {
          params: useParams(),
          loaderData: useLoaderData(),
          actionData: useActionData(),
          error: useRouteError(),
        };
        return h(ErrorBoundary, props);
      };
    }
  `;
}

export const removeExports = (
  ast: ParseResult<Babel.File>,
  exportsToRemove: string[]
): void => {
  const previouslyReferencedIdentifiers = findReferencedIdentifiers(ast);
  let exportsFiltered = false;
  const markedForRemoval = new Set<NodePath<Babel.Node>>();

  traverse(ast, {
    ExportDeclaration(path: NodePath) {
      // export { foo };
      // export { bar } from "./module";
      if (path.node.type === 'ExportNamedDeclaration') {
        if (path.node.specifiers.length) {
          //@ts-ignore
          path.node.specifiers = path.node.specifiers.filter(
            (
              specifier:
                | Babel.ExportSpecifier
                | Babel.ExportDefaultSpecifier
                | Babel.ExportNamespaceSpecifier
            ) => {
              // Filter out individual specifiers
              if (
                specifier.type === 'ExportSpecifier' &&
                specifier.exported.type === 'Identifier'
              ) {
                if (exportsToRemove.includes(specifier.exported.name)) {
                  exportsFiltered = true;
                  return false;
                }
              }
              return true;
            }
          );
          // Remove the entire export statement if all specifiers were removed
          if (path.node.specifiers.length === 0) {
            markedForRemoval.add(path);
          }
        }

        // export const foo = ...;
        // export const [ foo ] = ...;
        if (path.node.declaration?.type === 'VariableDeclaration') {
          const declaration = path.node.declaration;
          declaration.declarations = declaration.declarations.filter(
            (declaration: Babel.VariableDeclarator) => {
              // export const foo = ...;
              // export const foo = ..., bar = ...;
              if (
                declaration.id.type === 'Identifier' &&
                exportsToRemove.includes(declaration.id.name)
              ) {
                // Filter out individual variables
                exportsFiltered = true;
                return false;
              }

              // export const [ foo ] = ...;
              // export const { foo } = ...;
              if (
                declaration.id.type === 'ArrayPattern' ||
                declaration.id.type === 'ObjectPattern'
              ) {
                // NOTE: These exports cannot be safely removed, so instead we
                // validate them to ensure that any exports that are intended to
                // be removed are not present
                validateDestructuredExports(declaration.id, exportsToRemove);
              }

              return true;
            }
          );
          // Remove the entire export statement if all variables were removed
          if (declaration.declarations.length === 0) {
            markedForRemoval.add(path);
          }
        }

        // export function foo() {}
        if (path.node.declaration?.type === 'FunctionDeclaration') {
          const id = path.node.declaration.id;
          if (id && exportsToRemove.includes(id.name)) {
            markedForRemoval.add(path);
          }
        }

        // export class Foo() {}
        if (path.node.declaration?.type === 'ClassDeclaration') {
          const id = path.node.declaration.id;
          if (id && exportsToRemove.includes(id.name)) {
            markedForRemoval.add(path);
          }
        }
      }

      // export default ...;
      if (
        path.node.type === 'ExportDefaultDeclaration' &&
        exportsToRemove.includes('default')
      ) {
        markedForRemoval.add(path);
      }
    },
  });
  if (markedForRemoval.size > 0 || exportsFiltered) {
    for (const path of markedForRemoval) {
      path.remove();
    }

    // Run dead code elimination on any newly unreferenced identifiers
    deadCodeElimination(ast, previouslyReferencedIdentifiers);
  }
};

export const transformRoute = (ast: ParseResult<Babel.File>): void => {
  const hocs: Array<[string, Babel.Identifier]> = [];
  function getHocUid(path: NodePath, hocName: string) {
    const uid = path.scope.generateUidIdentifier(hocName);
    hocs.push([hocName, uid]);
    return uid;
  }

  traverse(ast, {
    ExportDeclaration(path: NodePath) {
      if (path.isExportDefaultDeclaration()) {
        const declaration = path.get('declaration');
        // prettier-ignore
        const expr =
              declaration.isExpression() ? declaration.node :
                  declaration.isFunctionDeclaration() ? toFunctionExpression(declaration.node) :
                      undefined
        if (expr) {
          const uid = getHocUid(path, 'withComponentProps');
          declaration.replaceWith(t.callExpression(uid, [expr]) as any);
        }
        return;
      }

      if (path.isExportNamedDeclaration()) {
        const decl = path.get('declaration');

        if (decl.isVariableDeclaration()) {
          // biome-ignore lint/complexity/noForEach: <explanation>
          decl.get('declarations').forEach((varDeclarator: NodePath) => {
            const id = varDeclarator.get('id') as any;
            const init = varDeclarator.get('init') as any;
            const expr = init.node as any;
            if (!expr) return;
            if (!id.isIdentifier()) return;
            const { name } = id.node;
            if (!isNamedComponentExport(name)) return;

            const uid = getHocUid(path, `with${name}Props`);
            init.replaceWith(t.callExpression(uid, [expr]));
          });
          return;
        }

        if (decl.isFunctionDeclaration()) {
          const { id } = decl.node;
          if (!id) return;
          const { name } = id;
          if (!isNamedComponentExport(name)) return;

          const uid = getHocUid(path, `with${name}Props`);
          decl.replaceWith(
            t.variableDeclaration('const', [
              t.variableDeclarator(
                t.identifier(name),
                t.callExpression(uid, [toFunctionExpression(decl.node)])
              ),
            ]) as any
          );
        }
      }
    },
  });

  if (hocs.length > 0) {
    ast.program.body.unshift(
      t.importDeclaration(
        hocs.map(([name, identifier]) =>
          t.importSpecifier(identifier, t.identifier(name))
        ),
        t.stringLiteral('virtual/react-router/with-props')
      ) as any
    );
  }
};

function isNamedComponentExport(
  name: string
): name is (typeof NAMED_COMPONENT_EXPORTS)[number] {
  return (NAMED_COMPONENT_EXPORTS as readonly string[]).includes(name);
}
