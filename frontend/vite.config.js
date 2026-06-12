import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Прокси: запросы фронта на /api перенаправляются на бэкенд (порт 5001).
// Если у тебя бэкенд на другом порту — поменяй target ниже.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:5001',
        changeOrigin: true
      }
    }
  }
});
