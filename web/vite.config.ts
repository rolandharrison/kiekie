import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

// Built straight into the Worker's asset directory so there is one deployable.
export default defineConfig({
  plugins: [preact()],
  build: {
    outDir: '../worker/public',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8787',
      '/img': 'http://localhost:8787',
      '/p': 'http://localhost:8787',
    },
  },
});
