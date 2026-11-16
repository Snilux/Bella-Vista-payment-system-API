// Jest with jest-expo (3.2 §2): components, the HTTP client and the error messages.
const path = require('node:path');

module.exports = {
  preset: 'jest-expo',
  testMatch: ['<rootDir>/test/**/*.test.ts?(x)'],
  setupFiles: ['<rootDir>/test/setup.ts'],
  moduleNameMapper: {
    // The shared package by its TypeScript sources (its "development" export).
    '^@bella-vista/shared$': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
    // Relative imports written with ".js" (NodeNext style) point to .ts/.tsx files.
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
};
