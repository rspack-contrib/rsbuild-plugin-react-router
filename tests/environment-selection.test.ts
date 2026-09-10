import * as fs from 'node:fs';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createLogger, createRsbuild } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';
import { afterEach, expect, it } from '@rstest/core';
import { pluginReactRouter } from '../src';

// Real Rsbuild with the build narrowed to one environment (`rsbuild build
// --environment node`). The plugin must not ask Rsbuild for the `web`
// environment's normalized config in that case: `getNormalizedConfig({
// environment })` throws for environments filtered out of the build.

let fixtureRoot: string | undefined;
const repositoryRoot = process.cwd();

afterEach(() => {
  process.chdir(repositoryRoot);
  if (fixtureRoot) {
    rmSync(fixtureRoot, { recursive: true, force: true });
    fixtureRoot = undefined;
  }
});

it('creates the compiler when only the node environment is selected', async () => {
  const temporaryFixtures = join(repositoryRoot, 'tests/.tmp-dev-runtime');
  mkdirSync(temporaryFixtures, { recursive: true });
  fixtureRoot = mkdtempSync(join(temporaryFixtures, 'env-'));
  cpSync(join(repositoryRoot, 'tests/fixtures/dev-runtime'), fixtureRoot, {
    recursive: true,
  });
  (fs.existsSync as { mockRestore?: () => void }).mockRestore?.();
  // The plugin resolves the app directory from the working directory.
  process.chdir(fixtureRoot);

  const rsbuild = await createRsbuild({
    cwd: fixtureRoot,
    environment: ['node'],
    rsbuildConfig: {
      root: fixtureRoot,
      customLogger: createLogger({ level: 'silent' }),
      output: { assetPrefix: 'https://cdn.example.com/app/' },
      plugins: [pluginReactRouter({ lazyCompilation: false }), pluginReact()],
    },
  });

  // `createCompiler` runs `onBeforeCreateCompiler`, where the prefix lookup
  // happens.
  const compiler = await rsbuild.createCompiler();
  const names =
    'compilers' in compiler
      ? compiler.compilers.map(child => child.name)
      : [compiler.name];
  expect(names).toEqual(['node']);
  expect(rsbuild.getNormalizedConfig().environments.web).toBeUndefined();
}, 60_000);
