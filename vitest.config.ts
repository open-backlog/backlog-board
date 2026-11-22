import { defineConfig } from 'vitest/config';

// The server's tests (node). The app's tests run through ng test (Angular's Vitest runner).
export default defineConfig({ test: { include: ['test/**/*.test.ts'], environment: 'node' } });
