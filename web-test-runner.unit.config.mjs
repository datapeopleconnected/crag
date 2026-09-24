import { importMapsPlugin } from '@web/dev-server-import-maps';
import { esbuildPlugin } from '@web/dev-server-esbuild';

const filteredLogs = ['Running in dev mode', 'lit-html is in dev mode'];

export default /** @type {import("@web/test-runner").TestRunnerConfig} */ ({
  // Served straight from source: esbuild strips the types and maps the `.js`
  // imports onto their `.ts` files, so no build step is needed first.
  files: 'test/unit/**/*.test.ts',
  plugins: [
    importMapsPlugin({ inject: {
      importMap: {
        imports: {
          'crypto': '/node_modules/false-file.js',
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