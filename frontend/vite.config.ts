import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiProxy = { target: 'http://127.0.0.1:8787', changeOrigin: true };
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': apiProxy } },
  preview: { proxy: { '/api': apiProxy } },
  build: { sourcemap: false },
});
