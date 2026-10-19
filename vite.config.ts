import { defineConfig } from 'vite';

export default defineConfig({
  root: 'client',
  build: { outDir: '../dist', emptyOutDir: true },
  server: {
    port: 5173,
    fs: { allow: ['..'] }, // client imports ../shared
    proxy: { '/ws': { target: 'ws://localhost:8080', ws: true } },
  },
});
