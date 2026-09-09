import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';
import { resolve } from 'node:path';
export default defineConfig({
  root: resolve('web'),
  publicDir: resolve('public'),
  worker: { format: 'es' },
  plugins: [react()],
  resolve: { alias: { '@': resolve('.') } },
  css: { postcss: { plugins: [tailwindcss()] } },
  build: { outDir: resolve('dist/web'), emptyOutDir: true },
});
