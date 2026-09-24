import { nodeResolve } from '@rollup/plugin-node-resolve';
import { transform } from 'esbuild';

// Bundles the e2e test, plus the compiled output in ./dist, into browser-ready
// test fixtures. This is NOT the published artifact -- ./dist is. See
// package.json "files".

// The e2e test is TypeScript, so strip its types before bundling. This only
// transforms: imports still resolve through nodeResolve below, so
// `@buttress/crag` is bundled from the built ./dist, the code that ships.
// @rollup/plugin-typescript resolves through test/tsconfig.json's "paths" and
// would bundle ./src instead.
const stripTypes = {
  name: 'strip-types',
  async transform(code, id) {
    if (!id.endsWith('.ts')) return null;
    const result = await transform(code, { loader: 'ts', sourcefile: id, target: 'es2021' });
    return { code: result.code, map: null };
  },
};

export default {
  input: [
    'dist/components/buttress-db-service.js',
    'test/e2e/basic.test.ts',
    'dist/ButtressDataService.js',
    'dist/ButtressDbService.js',
    'dist/ButtressRealtime.js',
    'dist/ButtressSchema.js',
    'dist/ButtressSchemaFactory.js',
    'dist/ButtressStore.js',
    'dist/helpers.js',
    'dist/index.js',
  ], // Entry point
  output: {
    dir: "./.test-bundle",
    exports: "named",
    preserveModules: false,
    format: 'es',
  },
  plugins: [
    stripTypes,
    nodeResolve({
      browser: true
    })
  ],
};