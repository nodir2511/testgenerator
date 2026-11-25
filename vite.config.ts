/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { readFileSync, rmSync } from 'fs';

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
      // Бланки PDF бот берёт с GitHub (public/blanks), самому сайту они не нужны: в сборку не входят
      name: 'drop-blanks',
      apply: 'build',
      closeBundle() {
        rmSync(path.resolve(__dirname, 'dist/blanks'), { recursive: true, force: true });
      },
    },
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
  // Тесты прав доступа (tests-db) поднимают встроенный Postgres и запускаются отдельно: npm run test:db
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', 'tests-db/**'],
    // Сборка на Vercel запускает тесты на медленном сервере: тесты распознавания бланков там не укладываются в 5 секунд
    testTimeout: 60000,
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
          // react-dom/client указан отдельно: иначе сам React DOM попадает в основной файл и скачивается заново после каждого деплоя
          vendor: ['react', 'react-dom', 'react-dom/client'],
          supabase: ['@supabase/supabase-js'],
          query: ['@tanstack/react-query'],
          docx: ['docx'],
          sheets: ['read-excel-file/browser', 'write-excel-file/browser', 'papaparse'],
        },
      },
    },
  },
}));
