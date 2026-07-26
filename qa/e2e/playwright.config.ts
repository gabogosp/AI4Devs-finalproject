import { defineConfig, devices } from '@playwright/test';

// E2E cross-stack de la costura FE↔BE (T3.1). El stack (API :3000 + web) se
// levanta fuera (local o el job de CI); baseURL apunta al front.
export default defineConfig({
  testDir: '.',
  testMatch: /seam-.*\.spec\.ts$/,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  use: {
    baseURL: process.env.QA_WEB_BASE_URL || 'http://localhost:3100',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
