import { esbuildPlugin } from '@web/dev-server-esbuild';
import { fromRollup } from "@web/dev-server-rollup";

import rollupReplace from "@rollup/plugin-replace";

const replace = fromRollup(rollupReplace);

const filteredLogs = ['Lit is in dev mode'];

// scripts/e2e.js starts and seeds a Buttress for the run, then passes in its endpoint and tokens.
const env = process.env;
if (!env.BUTTRESS_E2E_ENDPOINT) {
  throw new Error(
    'BUTTRESS_E2E_ENDPOINT is not set. Run the end-to-end tests with `npm run test:e2e`, which starts Buttress.',
  );
}

export default /** @type {import("@web/test-runner").TestRunnerConfig} */ ({
  files: '.test-bundle/*.test.js',
  plugins: [
    replace({
      "BUILD_REPLACE_TESTE2E_WITH_ENDPOINT": env.BUTTRESS_E2E_ENDPOINT,
      "BUILD_REPLACE_TESTE2E_WITH_APP_TOKEN": env.BUTTRESS_E2E_APP_TOKEN,
      "BUILD_REPLACE_TESTE2E_WITH_USER1_TOKEN": env.BUTTRESS_E2E_USER1_TOKEN,
      "BUILD_REPLACE_TESTE2E_WITH_USER2_TOKEN": env.BUTTRESS_E2E_USER2_TOKEN,
    }),
    esbuildPlugin({ ts: true })
  ],

  /** Resolve bare module imports */
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

  /** Compile JS for older browsers. Requires @web/dev-server-esbuild plugin */
  // esbuildTarget: 'auto',

  /** Amount of browsers to run concurrently */
  // concurrentBrowsers: 2,

  /** Amount of test files per browser to test concurrently */
  // concurrency: 1,

  /** Browsers to run tests on */
  // browsers: [
  //   playwrightLauncher({ product: 'chromium' }),
  //   playwrightLauncher({ product: 'firefox' }),
  //   playwrightLauncher({ product: 'webkit' }),
  // ],

  // See documentation for all available options
});
