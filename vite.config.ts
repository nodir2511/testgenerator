import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync(path.resolve(__dirname, './package.json'), 'utf-8'));

// Идентификатор сборки: сайт сверяет его с /version.json и предлагает обновиться, когда вышла новая версия
const BUILD_ID = String(Date.now());

export default defineConfig(({ command }) => ({
  define: {
    __BUILD_ID__: JSON.stringify(command === 'build' ? BUILD_ID : 'dev'),
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    react(),
    {
      name: 'emit-version',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ id: BUILD_ID }) });
      },
    },
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    watch: {
      ignored: ['**/temp_docs/**', '**/node_modules/**', '**/dist/**'],
    },
  },
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          supabase: ['@supabase/supabase-js'],
          query: ['@tanstack/react-query'],
          docx: ['docx'],
          sheets: ['read-excel-file/browser', 'write-excel-file/browser', 'papaparse'],
        },
      },
    },
  },
}));
