import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import path from 'path';

const INPUT = process.env.INPUT;
if (!INPUT) throw new Error('INPUT env var is required (path to app HTML entry)');

const isDevelopment = process.env.NODE_ENV === 'development';

export default defineConfig({
  plugins: [react(), viteSingleFile()],
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'apps/shared'),
    },
  },
  build: {
    sourcemap: isDevelopment ? 'inline' : undefined,
    cssMinify: !isDevelopment,
    minify: !isDevelopment,
    rollupOptions: { input: INPUT },
    outDir: 'dist',
    emptyOutDir: false,
  },
});
