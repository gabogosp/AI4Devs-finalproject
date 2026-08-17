import { defineConfig, devices } from '@playwright/test';

// E2E cross-stack (Layer 3). El stack (API :3000 + web) se levanta fuera (local
// o el job de CI); baseURL apunta al front.
//
// testMatch cubre todos los specs MENOS los de a11y, que tienen su propio config
// con el runner de axe. Se amplió al sumar US-003: acotarlo a `seam-*` era una
// herencia de US-001 y dejaba fuera cualquier spec nuevo — en silencio, que es
// lo peor: Playwright reporta "No tests found", no un fallo.
export default defineConfig({
  testDir: '.',
  testMatch: /^(?!.*a11y).*\.spec\.ts$/,
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
