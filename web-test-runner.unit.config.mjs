import { importMapsPlugin } from '@web/dev-server-import-maps';
import { esbuildPlugin } from '@web/dev-server-esbuild';

const filteredLogs = ['Lit is in dev mode'];

export default /** @type {import("@web/test-runner").TestRunnerConfig} */ ({
  // Served straight from source: esbuild strips the types and maps the `.js`
  // imports onto their `.ts` files, so no build step is needed first.
  files: 'test/unit/**/*.test.ts',

  /**
   * One test file at a time. Headless Chrome doesn't run requestAnimationFrame callbacks in a background tab
   * (puppeteer#10350), and @web/test-runner-chrome 1.x no longer works around it by bringing each tab to the front.
   * fixture() of an element that isn't a Lit element waits for a frame, so it hangs when files run side by side.
   */
  concurrency: 1,

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