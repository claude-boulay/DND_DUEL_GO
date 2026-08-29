import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

// Dans Docker le backend est joignable par son nom de service ; en local direct
// c'est localhost. Le front n'appelle que des URLs relatives (/api, /socket.io),
// le proxy Vite en dev et Nginx en prod se chargent du routage.
const backendUrl = process.env.BACKEND_URL ?? 'http://localhost:3000';
const inDocker = process.env.DOCKER_ENV === 'true';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    // Les bind mounts Docker sous Windows/macOS ne propagent pas les
    // événements inotify : sans polling, le hot-reload ne se déclenche pas.
    watch: inDocker ? { usePolling: true, interval: 300 } : undefined,
    proxy: {
      '/api': { target: backendUrl, changeOrigin: true },
      '/uploads': { target: backendUrl, changeOrigin: true },
      '/socket.io': { target: backendUrl, ws: true, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
