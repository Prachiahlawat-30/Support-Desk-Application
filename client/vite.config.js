import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// In development the client calls /api/* on its own origin and Vite forwards it to Express.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': process.env.VITE_API_PROXY || 'http://localhost:4000',
    },
  },
});
