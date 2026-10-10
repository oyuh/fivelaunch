import { defineConfig } from 'vitest/config'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { svelteTesting } from '@testing-library/svelte/vite'
import tailwindcss from '@tailwindcss/vite'

// `bun run build:preview` (mode `app-preview`) builds the UI preview harness
// (index.preview.html -> src/preview.ts) into a static bundle in preview-dist/.
// The preview mocks the Tauri IPC bridge, so it runs in any plain browser,
// which lets the docs site embed the real app in an <iframe>.
export default defineConfig(({ mode }) => ({
  plugins: [svelte(), svelteTesting(), tailwindcss()],

  // Stop PostCSS config discovery from walking up into the v1 repo root
  // (its postcss.config.js loads Tailwind 3 and breaks the build).
  css: {
    postcss: { plugins: [] }
  },

  // Restrict dependency scanning to our own HTML entries so Vite doesn't crawl
  // into the local (gitignored) v1/ Electron+React app and fail on its imports.
  optimizeDeps: {
    entries: ['index.html', 'index.preview.html']
  },

  // The app only renders in WebView2 (evergreen Chromium) — skip syntax
  // downleveling for older browsers; smaller output, faster parse.
  // The preview bundle uses relative asset URLs so it works from a sub-path
  // (e.g. https://fivelaunch.help/app-preview/) and keeps default targets.
  ...(mode === 'app-preview'
    ? {
        base: './',
        build: {
          outDir: 'preview-dist',
          emptyOutDir: true,
          rollupOptions: { input: 'index.preview.html' }
        }
      }
    : { build: { target: 'chrome120' } }),

  // Tauri expects a fixed port; fail if unavailable instead of picking another.
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      ignored: ['**/src-tauri/**', '**/v1/**']
    }
  },

  // Don't clear the terminal — it hides Rust build errors during `tauri dev`.
  clearScreen: false,

  test: {
    // Component tests render real Svelte components against a mocked Tauri
    // IPC bridge (@tauri-apps/api/mocks) — see src/tests/.
    environment: 'jsdom',
    setupFiles: ['./src/tests/setup.ts']
  }
}))
