import { nodeResolve } from '@rollup/plugin-node-resolve';

// Bundles the compiled output in ./dist into browser-ready test fixtures.
// This is NOT the published artifact -- ./dist is. See package.json "files".

export default {
  input: [
    'dist/components/buttress-db-service.js',
    'dist/test/e2e/basic.test.js',
    'dist/test/unit/basic.test.js',
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
    nodeResolve({
      browser: true
    })
  ],
};