import js from '@eslint/js'

export default [
  {
    ignores: ['dist/**', 'vite.config.js'],
  },

  js.configs.recommended,

  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globalThis,
      },
    },

    rules: {
      'no-undef': 'off',
      'no-unused-vars': 'warn',
    },
  },
]
