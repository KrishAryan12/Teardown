import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'brag-output*/**',
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/out/**',
      '**/coverage/**',
      '.space-build/**',
      'apps/web/next-env.d.ts',
      'fixtures/**',
      'apps/scanner/src/generated/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    // Scripts injected into scanned pages run in the browser.
    files: ['apps/scanner/inpage/**/*.js'],
    languageOptions: { globals: { ...globals.browser }, sourceType: 'script' },
    rules: {
      // Each file is a single function expression evaluated by Playwright, written in ES5-style JS.
      '@typescript-eslint/no-unused-expressions': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { caughtErrors: 'none' }],
      'no-redeclare': 'off',
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}', 'apps/web/scripts/**/*.mjs'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ['**/*.cjs'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node } },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
);
