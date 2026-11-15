// Lint for the server (issue #177): correctness rules only, no style.
// `npm run lint` fails on any warning, so a rule is either an error or off.
import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/'] },
  js.configs.recommended,
  {
    files: ['**/*.{js,mjs}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node,
    },
    rules: {
      // `const { omitted, ...rest } = x` is how this code drops a key.
      'no-unused-vars': ['error', { ignoreRestSiblings: true }],
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
  },
];
