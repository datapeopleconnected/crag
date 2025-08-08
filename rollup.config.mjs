import { nodeResolve } from '@rollup/plugin-node-resolve';

// entryPoints.map((name) => `development/${name}.js`),

export default {
  input: [
    'development/components/buttress-db-service.js',
    'development/test/e2e/basic.test.js',
    'development/test/unit/basic.test.js',
    'development/ButtressDataService.js',
    'development/ButtressDbService.js',
    'development/ButtressRealtime.js',
    'development/ButtressSchema.js',
    'development/ButtressSchemaFactory.js',
    'development/ButtressStore.js',
    'development/helpers.js',
    'development/index.js',
  ], // Entry point
  output: {
    dir: "./dist",
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