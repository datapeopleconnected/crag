import { defineConfig } from 'eslint/config';
import js from '@eslint/js';
import globals from 'globals';
import openWC from '@open-wc/eslint-config';
import lit from 'eslint-plugin-lit';
import wc from 'eslint-plugin-wc';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';

export default defineConfig([
  {
    ignores: [
      'build/**',
      'out-tsc/**',
      'playwright-report/**',
      'test-results/**',
      'dist/**',
      '.test-bundle/**',
      'coverage/**',
      '.claude/**',
    ],
  },
  js.configs.recommended,
  // Also provides the browser and Mocha globals, and the import-x plugin whose rules are adjusted below.
  ...openWC,
  lit.configs['flat/recommended'],
  wc.configs['flat/recommended'],
  {
    files: ['src/**/*.ts', 'test/**/*.ts'],
    extends: [tseslint.configs.recommended],
    rules: {
      // A warning for now: there are still around 200 of these to replace with real types.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
      // TypeScript already checks that imports resolve, and this resolver can't map `.js` imports to `.ts` files.
      'import-x/no-unresolved': 'off',
      'class-methods-use-this': 'off',
      'no-var': 'error',
      'prefer-const': 'error',
      eqeqeq: 'error',
    },
  },
  {
    // Chai assertions such as `expect(value).to.be.true` are expressions on their own.
    files: ['test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-expressions': 'off',
    },
  },
  {
    // Config files and scripts run in Node.
    files: ['*.config.{js,mjs}', 'scripts/**/*.js'],
    languageOptions: {
      globals: globals.node,
    },
  },
  // Must stay last: switches off the formatting rules that would otherwise
  // fight Prettier over the same code. See .prettierrc.json.
  eslintConfigPrettier,
]);
