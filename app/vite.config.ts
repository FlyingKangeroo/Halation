import { defineConfig } from 'vitest/config';

// Tauri expects a fixed dev port and relative asset paths in production.
export default defineConfig({
  base: './',
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: { target: ['es2022', 'safari15'], sourcemap: false },
  test: { include: ['tests/**/*.test.ts'] },
});
