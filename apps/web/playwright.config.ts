import { defineConfig, devices } from '@playwright/test';

// Smoke E2E (T8.5). Corre contra `next build && next start` (no dev).
//
// El puerto es configurable por env: el default original (3100) es el puerto
// por defecto de Grafana Loki, así que colisiona en cualquier máquina que corra
// un stack de observabilidad — el `webServer` moría con EADDRINUSE sin que el
// spec llegara a ejecutarse. Override con `E2E_PORT` si 3210 también está tomado.
const PORT = Number(process.env.E2E_PORT ?? 3210);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: `pnpm build && pnpm start -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180000,
  },
});
