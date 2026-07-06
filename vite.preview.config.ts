import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'

// One-off build of the no-build UI preview harness (index.preview.html ->
// src/preview.ts) into a self-contained static bundle. The preview mocks the
// Tauri IPC bridge, so the output runs in any plain browser with no Rust — which
// lets the docs site embed the real app in an <iframe>.
//
// Usage: node_modules/.bin/vite build --config vite.preview.config.ts
export default defineConfig({
  // Relative asset URLs so the bundle works when served from a sub-path
  // (e.g. https://fivelaunch.help/app-preview/).
  base: './',
  plugins: [svelte(), tailwindcss()],
  css: {
    postcss: { plugins: [] }
  },
  build: {
    outDir: 'preview-dist',
    emptyOutDir: true,
    rollupOptions: {
      input: 'index.preview.html'
    }
  }
})
