import { defineConfig } from "eslint/config";
import openWC from "@open-wc/eslint-config";
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';

import importPlugin from 'eslint-plugin-import-x';
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
    ],
  },
  ...openWC,
  {
    files: ['src/**/*.{ts,js,mjs,cjs}', 'test/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        window: 'readonly',
        document: 'readonly',
        customElements: 'readonly',
        HTMLElement: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      'import-x': importPlugin,
    },
    rules: {
      'no-unused-vars': 'off',
      'arrow-parens': ['error', 'always'],
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
      quotes: ['error', 'single', { avoidEscape: true }],
    },
  },
  // Must stay last: switches off the formatting rules that would otherwise
  // fight Prettier over the same code. See .prettierrc.json.
  eslintConfigPrettier,
]);