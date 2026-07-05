import { defineConfig } from 'vitest/config'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { svelteTesting } from '@testing-library/svelte/vite'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [svelte(), svelteTesting(), tailwindcss()],

  // Stop PostCSS config discovery from walking up into the v1 repo root
  // (its postcss.config.js loads Tailwind 3 and breaks the build).
  css: {
    postcss: { plugins: [] }
  },

  // Tauri expects a fixed port; fail if unavailable instead of picking another.
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      ignored: ['**/src-tauri/**']
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
})
