import { defineConfig, devices } from '@playwright/test';

// E2E contra `next build && next start` (no dev).
//
// El puerto es configurable por env: el default original (3100) es el puerto por
// defecto de Grafana Loki, así que colisiona en cualquier máquina que corra un
// stack de observabilidad — el `webServer` moría con EADDRINUSE sin que llegara
// a ejecutarse un solo spec. Override con `E2E_PORT` / `API_STUB_PORT`.
const PORT = Number(process.env.E2E_PORT ?? 3210);
const STUB_PORT = Number(process.env.API_STUB_PORT ?? 4010);

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
  webServer: [
    {
      // Stub del contrato: el fetch de la ficha es server-side, así que
      // `page.route` no lo intercepta (design.md D10).
      command: `node e2e/support/api-stub.mjs`,
      url: `http://localhost:${STUB_PORT}/health`,
      reuseExistingServer: !process.env.CI,
      env: { API_STUB_PORT: String(STUB_PORT) },
    },
    {
      command: `pnpm build && pnpm start -p ${PORT}`,
      url: `http://localhost:${PORT}`,
      // ⚠ Las NEXT_PUBLIC_* se inlinean en BUILD, no se leen en runtime: si esto
      // fuera sólo del proceso `start`, el bundle apuntaría al default.
      env: {
        NEXT_PUBLIC_API_BASE_URL: `http://localhost:${STUB_PORT}`,
        NEXT_PUBLIC_SITE_URL: `http://localhost:${PORT}`,
      },
      reuseExistingServer: !process.env.CI,
      timeout: 180000,
    },
  ],
});
