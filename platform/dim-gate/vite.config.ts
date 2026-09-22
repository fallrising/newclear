import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  base: process.env.DIM_GATE_BASE ?? '/dim-gate/',
  plugins: [react(), tailwindcss()],
  build: {
    manifest: true,
    // Rolldown's smart constant inlining duplicates tldts' 64 KiB suffix
    // string at conditional charCodeAt uses. Preserve the single shared
    // constant and all MSW cookie semantics instead of shipping copies.
    rolldownOptions: { optimization: { inlineConst: false } },
  },
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: { environment: 'node', include: ['src/**/*.test.ts', 'src/**/*.test.tsx'] },
})
