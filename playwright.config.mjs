import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'security-tests/browser',
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:8080',
    headless: true,
  },
  webServer: {
    command: 'node serve.mjs',
    url: 'http://localhost:8080',
    reuseExistingServer: true,
    timeout: 15_000,
  },
});
