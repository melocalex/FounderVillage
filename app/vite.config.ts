import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  // Codama's generated error helpers read process.env['NODE_ENV'], which browsers lack.
  define: { 'process.env': JSON.stringify({ NODE_ENV: mode }) },
  server: { port: 5183, strictPort: true, fs: { allow: ['..'] } },
  build: { outDir: 'dist', target: 'es2022' },
}));
