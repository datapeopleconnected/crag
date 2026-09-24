import { importMapsPlugin } from '@web/dev-server-import-maps';
import { esbuildPlugin } from '@web/dev-server-esbuild';

const filteredLogs = ['Running in dev mode', 'lit-html is in dev mode'];

export default /** @type {import("@web/test-runner").TestRunnerConfig} */ ({
  // Served straight from source: esbuild strips the types and maps the `.js`
  // imports onto their `.ts` files, so no build step is needed first.
  files: 'test/unit/**/*.test.ts',

  /**
   * Used when run with --coverage (npm run test:coverage). The run fails if coverage drops below these
   * floors, which sit just under the current figures: raise them as coverage improves.
   */
  coverageConfig: {
    include: ['src/**/*.ts'],
    threshold: { statements: 50, branches: 75, functions: 35, lines: 50 },
  },
  plugins: [
    importMapsPlugin({ inject: {
      importMap: {
        imports: {
          'crypto': '/node_modules/false-file.js',
          // socket.io-parser >=4.2.7 maps the 'development' condition (see nodeResolve below) to a
          // debug build that imports the CommonJS `debug` package, which browsers can't load.
          'socket.io-parser': '/node_modules/socket.io-parser/build/esm/index.js',
        }
      }
    }}),
    // tsconfig so esbuild compiles src/ as tsc does (experimentalDecorators, target).
    esbuildPlugin({ ts: true, tsconfig: 'tsconfig.json' })
  ],

  /**
   * Resolve bare module imports. Don't also pass --node-resolve on the CLI: it replaces this
   * object, and socket.io-client then resolves to its Node build (which imports `ws`).
   */
  nodeResolve: {
    exportConditions: ['browser', 'development'],
    browser: true,
    preferBuiltins: false
  },

  /** Filter out lit dev mode logs */
  filterBrowserLogs(log) {
    for (const arg of log.args) {
      if (typeof arg === 'string' && filteredLogs.some(l => arg.includes(l))) {
        return false;
      }
    }
    return true;
  },
});