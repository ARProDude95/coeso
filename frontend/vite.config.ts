/// <reference types="vitest/config" />
import { configDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    // Multi-page: the visual-regression harness (visual.html) is a second
    // entry alongside the app's index.html so `vite build` emits it too.
    rollupOptions: {
      input: {
        main: 'index.html',
        visual: 'visual.html',
      },
    },
  },
  server: {
    port: 5173,
    // Vite 7 rejects unknown Host headers (DNS-rebinding protection), which
    // blocks the Cloudflare quick tunnel used to share this dev server.
    // Scoped to the tunnel's domain only — the dev server still binds to
    // localhost, and this setting does not exist in production builds.
    allowedHosts: ['.trycloudflare.com'],
    proxy: {
      // Same-origin in dev so cookies/headers behave like production and CORS
      // never enters the picture. The Vite server forwards to the backend.
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
        // When this dev server is shared through a tunnel (e.g. quick tunnel),
        // the browser sends the tunnel origin on same-origin POSTs. The backend
        // allowlist only knows http://localhost:5173, so override the forwarded
        // Origin header (proxy `headers` win over the incoming request's).
        // Dev-only: production is same-origin already.
        headers: { origin: 'http://localhost:5173' },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
    css: false,
    // e2e/ holds Playwright specs (run by `npm run test:visual`), not vitest —
    // its *.spec.ts files must not be collected by the unit runner.
    exclude: [...configDefaults.exclude, 'e2e/**', '**/playwright.config.ts'],
  },
});
