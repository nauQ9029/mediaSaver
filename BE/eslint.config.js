import eslint from '@eslint/js';

export default [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'src/generated/**',
      'coverage/**',
      'prisma/migrations/**',
    ],
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    ...eslint.configs.recommended,
    languageOptions: {
      ...eslint.configs.recommended.languageOptions,
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
      },
    },
    rules: {
      ...eslint.configs.recommended.rules,
      // TypeScript's compiler handles unused declarations in TS source.
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
];
