import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Python FastAPI framework (main/)
      '/api/v1': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      // HAPI Hub
      '/hapi-api': {
        target: 'http://localhost:3006',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/hapi-api/, ''),
      },
      // OpenCode API (agents/)
      '/api': {
        target: 'http://localhost:9876',
        changeOrigin: true,
      },
    },
  },
});
