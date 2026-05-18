import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Dev server proxies `/api` to the control-plane so the SPA can call the API
 * with same-origin cookies and no CORS hassle. In production the SPA is
 * served from a CDN / static bucket and points to the API base via VITE_API_URL.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_URL ?? 'http://localhost:4100',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
