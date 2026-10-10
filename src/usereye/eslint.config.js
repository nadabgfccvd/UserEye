'use strict';

/**
 * Flat ESLint config (roadmap items 0.7 / 5.1).
 *
 * The engine serializes functions into the browser via page.evaluate, so the
 * library sources legitimately reference both Node and browser globals.
 */

const globals = require('globals');

const nodeAndBrowser = { ...globals.node, ...globals.browser, ...globals.es2021 };

module.exports = [
  {
    ignores: [
      'node_modules/**',
      'tests/fixtures/**',
      'tests/benchmarks/**',
      'types/**',
      'coverage/**',
      '*.tgz',
    ],
  },
  {
    files: ['**/*.js', '**/*.cjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: nodeAndBrowser,
    },
    rules: {
      // eslint:recommended, inline (no plugin dependency needed)
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-undef': 'error',
      'no-const-assign': 'error',
      'no-dupe-keys': 'error',
      'no-duplicate-case': 'error',
      'no-unreachable': 'error',
      'no-constant-condition': ['error', { checkLoops: false }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-fallthrough': 'error',
      'no-redeclare': 'error',
      'no-self-assign': 'error',
      'no-unsafe-negation': 'error',
      'use-isnan': 'error',
      'valid-typeof': 'error',
      eqeqeq: ['error', 'smart'],
    },
  },
  {
    files: ['tests/**/*.js', 'scripts/**/*.js', 'examples/**/*.js'],
    languageOptions: {
      globals: { ...globals.node, ...globals.es2021 },
    },
    rules: {
      'no-console': 'off',
    },
  },
  {
    files: ['**/*.mjs'],
    languageOptions: {
      sourceType: 'module',
      globals: nodeAndBrowser,
    },
  },
];
