// Lint for the client and the template components it builds (issue #177):
// correctness rules and the two classic React hooks rules, no style.
// `npm run lint` fails on any warning, so a rule is either an error or off.
// templates/eslint.config.js re-exports this, since ESLint looks a file's
// config up from its own folder and templates/ sits outside client/.
import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  { ignores: ['node_modules/', 'dist/'] },
  { files: ['**/*.{js,jsx}'], ...js.configs.recommended },
  {
    files: ['**/*.{js,jsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        ...globals.browser,
        // vite.config.js's `define`, the release shown in the top bar.
        __APP_VERSION__: 'readonly',
      },
    },
    rules: {
      // `const { omitted, ...rest } = x` is how this code drops a key.
      'no-unused-vars': ['error', { ignoreRestSiblings: true }],
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
  },
  // Tests and the Vite config run in Node.
  {
    files: ['**/*.test.js', 'vite.config.js'],
    languageOptions: { globals: globals.node },
  },
];
