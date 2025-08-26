import process from 'node:process'
import { defineConfig } from 'tsup'

export default defineConfig(() => {
  const isDev = process.env.NODE_ENV === 'development'
  return {
    entry: ['src/index.ts'],
    external: ['vite'],
    dts: true,
    outDir: 'dist',
    format: ['cjs', 'esm'],
    platform: 'node',
    target: 'es2017',
    minify: !isDev,
    sourcemap: isDev,
    replaceNodeEnv: true,
  }
})
