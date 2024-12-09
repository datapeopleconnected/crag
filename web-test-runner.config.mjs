import fs from 'node:fs';

import { importMapsPlugin } from '@web/dev-server-import-maps';
import { esbuildPlugin } from '@web/dev-server-esbuild';
import { fromRollup } from "@web/dev-server-rollup";

import rollupReplace from "@rollup/plugin-replace";

const replace = fromRollup(rollupReplace);

const filteredLogs = ['Running in dev mode', 'lit-html is in dev mode'];

// Load the test app info from the file
let appInfo = null;
try {
  appInfo = JSON.parse(fs.readFileSync('test-app-token.json', 'utf8'));
} catch (e) {
  console.error('Failed to read test app data from file, please run before-e2e.js');
}

export default /** @type {import("@web/test-runner").TestRunnerConfig} */ ({
  files: 'dist/*.test.js',
  plugins: [
    importMapsPlugin({ inject: {
      importMap: {
        imports: {
          'crypto': '/node_modules/false-file.js',
        }
      }
    }}),
    replace({
      "BUILD_REPLACE_TESTE2E_WITH_ENDPOINT": 'https://test.local.buttressjs.com',
      "BUILD_REPLACE_TESTE2E_WITH_APP_TOKEN": appInfo.app.token,
      "BUILD_REPLACE_TESTE2E_WITH_USER1_TOKEN": appInfo.testUser1,
      "BUILD_REPLACE_TESTE2E_WITH_USER2_TOKEN": appInfo.testUser2,
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
