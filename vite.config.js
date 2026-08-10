import { defineConfig } from 'vite'
import stylelint from 'vite-plugin-stylelint'
import eslint from 'vite-plugin-eslint'
import { resolve } from 'path'

export default defineConfig({
  root: 'src',
  publicDir: '../public',
  build: {
    target: 'esnext',
    outDir: '../docs',
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'src/index.html'),
      },
    },
  },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  define: {
    __CACHE_LINE_SIZE__: 128,
    __JOB_ID__: 0,
    __ATTEMPTS__: 0,
    __SUCCESSES__: 1,
  },
  plugins: [stylelint(), eslint()],
})
