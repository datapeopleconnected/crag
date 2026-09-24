import { defineConfig } from 'eslint/config';
import openWC from '@open-wc/eslint-config';
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
      '.claude/**',
      'coverage/**',
    ],
  },
  // Also provides the browser and Mocha globals, and the import-x plugin whose rules are adjusted below.
  ...openWC,
  {
    files: ['src/**/*.{ts,js,mjs,cjs}', 'test/**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
    },
    rules: {
      'no-unused-vars': 'off',
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
      'import-x/no-unresolved': 'off',
      'import-x/extensions': 'warn',
      'class-methods-use-this': 'off',
      'no-var': 'error',
      'prefer-const': 'error',
      eqeqeq: 'error',
    },
  },
  // Must stay last: switches off the formatting rules that would otherwise
  // fight Prettier over the same code. See .prettierrc.json.
  eslintConfigPrettier,
]);
