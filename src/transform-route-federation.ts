import * as esbuild from 'esbuild';
import { parse, generate } from './babel.js';
import { SERVER_ONLY_ROUTE_EXPORTS } from './constants.js';
import { removeExports, transformRoute } from './plugin-utils.js';
import type { TransformArgs } from './types.js';

/**
 * Transforms route modules with the react-router-route-federation resource query
 * This handles proper code transformation for federated routes
 */
export async function transformRouteFederation(
  args: TransformArgs
): Promise<string> {
  let code = args.code;
  const defaultExportMatch = code.match(/\n\s{0,}([\w\d_]+)\sas default,?/);
  if (defaultExportMatch && typeof defaultExportMatch.index === 'number') {
    code =
      code.slice(0, defaultExportMatch.index) +
      code.slice(defaultExportMatch.index + defaultExportMatch[0].length);
    code += `\nexport default ${defaultExportMatch[1]};`;
  }

  // Step 2: Parse the input code into an AST.
  const ast = parse(code, {
    sourceType: 'module',
    plugins: ['typescript', 'jsx'],
  });

  // Step 3: Remove export declarations in a web environment.
  if (args.environment && args.environment.name === 'web') {
    const mutableServerOnlyRouteExports = [...SERVER_ONLY_ROUTE_EXPORTS];
    removeExports(ast, mutableServerOnlyRouteExports);
  }

  // Step 4: Apply any additional AST transformations.
  transformRoute(ast);

  // Step 5: Generate the transformed code while retaining the original formatting.
  const generated = generate(ast, {
    sourceMaps: true,
    filename: args.resource,
    sourceFileName: args.resourcePath,
    retainLines: true,
    compact: false,
    concise: false,
  });

  const transformedCode = generated.code;

  // Step 6: Process the transformed code with esbuild.build().
  const result = await esbuild.build({
    bundle: false,
    write: false,
    metafile: true,
    jsx: 'automatic',
    format: 'esm',
    platform: 'neutral',
    loader: {
      '.ts': 'ts',
      '.tsx': 'tsx',
    },
    stdin: {
      contents: transformedCode,
      resolveDir: args.context || undefined,
      sourcefile: args.resourcePath,
    },
  });

  const output = result.metafile.outputs['stdin.js'];
  if (args.environment?.name === 'node') {
    const res = `
    let cache;
    const loadRoute = async (exportName)=>{
      if(cache !== undefined) {
       return cache[exportName];
      }
     let exp = await import('${args.resourcePath}?react-router-route');
     cache = exp;
     return exp[exportName]
    }
    
    ${output.exports
      .map(exp => {
        if (exp === 'default') {
          return `export default (...args) => loadRoute("default").then(fn => typeof fn === 'function' ? fn(...args) : fn);`;
        }
        return `export const ${exp} = (...args) => loadRoute(${JSON.stringify(exp)}).then(fn => typeof fn === 'function' ? fn(...args) : fn);`;
      })
      .join('\n')}
    `;

    return res;
  }

  const res = `const moduleProxy = await import('${args.resourcePath}?react-router-route');
${
  output.exports.includes('default')
    ? `const { default: defaultExport, ${output.exports.filter(exp => exp !== 'default').join(', ')} } = moduleProxy;`
    : `const { ${output.exports.join(', ')} } = moduleProxy;`
}
export { ${output.exports.map(exp => (exp === 'default' ? 'defaultExport as default' : exp)).join(', ')} };
`;

  return res;
}
