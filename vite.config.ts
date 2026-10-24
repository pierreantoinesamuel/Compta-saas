import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['server/tests/**/*.test.ts', 'src/**/*.test.{ts,tsx}'],
    environmentMatchGlobs: [
      ['src/tests/a11y.test.tsx', 'jsdom'],
    ],
    env: {
      // Prevents db/client.ts from throwing at import time in unit tests.
      // Tests that actually call DB methods will fail gracefully at connect time.
      DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://test:test@localhost:5432/haxatax_test',
    },
  },
});
