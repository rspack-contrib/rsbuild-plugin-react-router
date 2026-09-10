import { test, expect } from "@playwright/test";

import { js } from "./helpers/create-fixture.js";
import { build, createProject, reactRouterConfig } from "./helpers/rsbuild.js";

// RSC framework mode reads the browser bootstrap scripts and client-reference
// chunks from the rspack RSC manifest, which only records chunk files whose
// emitted name ends in ".js". The plugin validates the *emitted* web output,
// so function filenames and `tools.rspack` overrides are covered, not just a
// string `output.filename.js`.

const appFiles = {
  "react-router.config.ts": reactRouterConfig({}),
  "app/components/counter.tsx": js`
    "use client";
    import { useState } from "react";
    export function Counter() {
      const [count, setCount] = useState(0);
      return <button data-inc onClick={() => setCount(count + 1)}>{count}</button>;
    }
  `,
  "app/routes/_index.tsx": js`
    import { Counter } from "../components/counter";
    export default function Index() {
      return <><h1 data-home>Home</h1><Counter /></>;
    }
  `,
};

const rsbuildConfigFile = (webConfig: string) => `
  import { defineConfig } from "@rsbuild/core";
  import { pluginReact } from "@rsbuild/plugin-react";
  import { pluginReactRouterRSC } from "rsbuild-plugin-react-router";

  export default defineConfig({
    plugins: [pluginReact(), pluginReactRouterRSC({ customServer: true })],
    environments: { web: ${webConfig} },
  });
`;

const cases = [
  {
    // A function filename: only the emitted output can reveal what it returns.
    name: "query-hash entry filename returned by a filename function",
    webConfig: `{ output: { filename: { js: (pathData) => "client-" + pathData.chunk.name + ".js?v=[contenthash:8]" } } }`,
    dropped: /client-index\.js\?v=[a-f0-9]{8}/,
  },
  {
    // A valid ".js" entry keeps `entryJsFiles` non-empty; the client-reference
    // chunks are what disappear, under an extension no classifier would guess.
    name: "unfamiliar async chunkFilename extension through tools.rspack",
    webConfig: `{ tools: { rspack: (config) => { config.output.chunkFilename = "static/js/async/[name].txt"; } } }`,
    dropped: /static\/js\/async\/[^"]+\.txt/,
  },
];

for (const testCase of cases) {
  test(`RSC build rejects browser scripts the RSC manifest would drop: ${testCase.name}`, async () => {
    const cwd = await createProject(
      { ...appFiles, "rsbuild.config.ts": rsbuildConfigFile(testCase.webConfig) },
      "rsc-framework",
    );
    const result = build({ cwd });
    const output = result.stdout.toString() + result.stderr.toString();
    expect(result.status, output).not.toBe(0);
    expect(output).toMatch(/RSC mode requires every browser JavaScript asset to be named "\*\.js"/);
    expect(output).toMatch(testCase.dropped);
  });
}

test("RSC build accepts hashed .js browser filenames", async () => {
  const cwd = await createProject(
    {
      ...appFiles,
      "rsbuild.config.ts": rsbuildConfigFile(
        `{ output: { filename: { js: "[contenthash:8]-[name].js" } } }`,
      ),
    },
    "rsc-framework",
  );
  const result = build({ cwd });
  expect(result.status, result.stderr.toString()).toBe(0);
});
