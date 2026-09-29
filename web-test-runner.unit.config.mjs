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
   * Chrome gets 90s, not the default 30s, to open a test page. On a slow CI runner it has taken longer than 30s,
   * failing the run before any test started.
   */
  browserStartTimeout: 90000,

  /**
   * Used when run with --coverage (npm run test:coverage). The run fails if coverage drops below these floors.
   * Every branch is covered, but the merged report shows a few in ButtressStore and Logger as missed: when a test
   * file runs on a page an earlier file used, V8 reports fewer block ranges for modules it loaded before. Each
   * file run on its own (--files) reports them covered.
   */
  coverageConfig: {
    include: ['src/**/*.ts'],
    threshold: { statements: 100, branches: 99, functions: 100, lines: 100 },
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