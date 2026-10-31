import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'out/**',
      'node_modules/**',
      'webview-ui/**',
      'resources/**',
      '**/*.js.map'
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts', 'test/**/*.ts', 'packages/**/src/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node
      }
    },
    rules: {
      // Kod kalitesi skill'i: açık tip tanımları ve temiz akış
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'prefer-const': 'error',
      'no-var': 'error',
      eqeqeq: ['error', 'smart']
    }
  },
  {
    // Node betikleri (build/temizlik) CommonJS veya .mjs olabilir
    files: ['scripts/**/*.mjs', 'test/support/**/*.mjs', 'esbuild.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node
      }
    },
    rules: {
      'no-console': 'off'
    }
  },
  {
    // esbuild.js CommonJS olarak çalışır; require orada yerleşik desendir
    files: ['esbuild.js'],
    languageOptions: {
      sourceType: 'commonjs'
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off'
    }
  },
  {
    // CLI terminale yazmak zorundadır
    files: ['packages/cli/src/**/*.ts'],
    rules: {
      'no-console': 'off'
    }
  }
);
