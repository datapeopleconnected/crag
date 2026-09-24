import { importMapsPlugin } from '@web/dev-server-import-maps';
// import { hmrPlugin, presets } from '@open-wc/dev-server-hmr';

/** Use Hot Module replacement by adding --hmr to the start command */
const hmr = process.argv.includes('--hmr');

export default /** @type {import('@web/dev-server').DevServerConfig} */ ({
  open: '/demo/',
  /** Use regular watch mode if HMR is not enabled. */
  watch: !hmr,
  /** Resolve bare module imports */
  nodeResolve: {
    browser: true,
    exportConditions: ['browser', 'development'],
  },

  /** Compile JS for older browsers. Requires @web/dev-server-esbuild plugin */
  // esbuildTarget: 'auto',

  /** Set appIndex to enable SPA routing */
  // appIndex: 'demo/index.html',

  plugins: [
    // socket.io-parser >=4.2.7 maps the 'development' condition above to a debug build that imports
    // the CommonJS `debug` package, which browsers can't load. Same override as the unit test config.
    importMapsPlugin({
      inject: {
        importMap: {
          imports: { 'socket.io-parser': '/node_modules/socket.io-parser/build/esm/index.js' },
        },
      },
    }),
    /** Use Hot Module Replacement by uncommenting. Requires @open-wc/dev-server-hmr plugin */
    // hmr && hmrPlugin({ exclude: ['**/*/node_modules/**/*'], presets: [presets.litElement] }),
  ],

  // See documentation for all available options
});
