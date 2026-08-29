import { defineConfig, devices } from '@playwright/test';

// Accesibilidad (T4.2): axe-core sobre las pantallas del panel contra la API real.
export default defineConfig({
  testDir: '.',
  testMatch: /a11y\.spec\.ts$/,
  fullyParallel: false,
  reporter: 'list',
  use: {
    baseURL: process.env.QA_WEB_BASE_URL || 'http://localhost:3100',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
