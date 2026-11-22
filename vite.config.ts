import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import backend from './electron/backend.json';

const backendOrigin = process.env.UNDERCTRL_API_ORIGIN || backend.origin;

export default defineConfig({
  plugins: [react()],
  define: { 'import.meta.env.UNDERCTRL_API_ORIGIN': JSON.stringify(backendOrigin) },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    watch: { ignored: ['**/release/**'] },
    hmr: { host: '127.0.0.1', protocol: 'ws', clientPort: 5173 },
    proxy: { '/api': { target: backendOrigin, changeOrigin: true } },
  },
});
