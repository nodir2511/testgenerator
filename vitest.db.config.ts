// Тесты прав доступа на встроенном Postgres: запускаются отдельно от обычных (npm run test:db), одна база на весь прогон.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests-db/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
});
