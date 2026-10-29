import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// In development the client calls /api/* and /socket.io on its own origin and Vite forwards them to Express.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': process.env.VITE_API_PROXY || 'http://localhost:4000',
      // Socket.IO (real-time ticket updates), including the WebSocket upgrade.
      '/socket.io': { target: process.env.VITE_API_PROXY || 'http://localhost:4000', ws: true },
    },
  },
});
