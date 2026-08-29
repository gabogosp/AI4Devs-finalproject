import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { csvFilas } from '../support/import-files';

/**
 * TC-621 — accesibilidad de las tres pantallas del import (WCAG 2.1 AA).
 *
 * Selector, progreso y resultado tienen cada una su propia superficie de
 * fallo (`qa-plan.md` §6): el input de archivo + su etiqueta, la barra con
 * `aria-valuenow`/indeterminada + región viva, y la tabla de rechazos con
 * encabezados y paginación.
 *
 * **Progreso y resultado están bloqueadas hoy** por un defecto real (no de
 * este test): el frontend manda `idempotency-key` en cada `POST
 * /v1/admin/imports` y el CORS del backend no lo permite en `allowedHeaders`
 * (`bootstrap.ts`) — el navegador rechaza el preflight y ningún import
 * completa desde un browser real (ver `docs/RUN-MVP.md` §US-006). Sólo
 * `TC-621a` (selector, sin submit) corre hoy; `TC-621b`/`TC-621c` quedan
 * escritas y `test.fixme` hasta que el fix de CORS esté.
 */

const BOOTSTRAP = process.env.ADMIN_BOOTSTRAP_TOKEN || 'qa-bootstrap';

async function login(page: Page): Promise<void> {
  await page.goto('/admin/acceso');
  await page.getByLabel(/Token de acceso/).fill(BOOTSTRAP);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL(/\/admin\/productos/);
}

async function auditarWcagAA(page: Page, estado: string): Promise<void> {
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();
  expect(
    violations.map((v) => `${v.id}: ${v.help}`),
    `violaciones WCAG AA en el import (${estado})`,
  ).toEqual([]);
}

test('TC-621a — selector: input de archivo con su etiqueta, sin violaciones', async ({
  page,
}) => {
  await login(page);
  await page.goto('/admin/importar');
  await expect(page.getByLabel(/Archivo del catálogo/)).toBeVisible();
  await auditarWcagAA(page, 'selector');
});

test.fixme(
  'TC-621b — progreso: barra + región viva anuncian el avance, sin violaciones',
  async ({ page }) => {
    // Bloqueado por el defecto de CORS de idempotency-key (ver docstring del
    // archivo): el POST nunca sale del navegador, así que la pantalla nunca
    // llega a "Importando el catálogo".
    await login(page);
    await page.goto('/admin/importar');
    await page
      .locator('#archivo-import')
      .setInputFiles({ name: 'grande.csv', mimeType: 'text/csv', buffer: csvFilas(5_000) });
    await page.getByRole('button', { name: 'Importar catálogo' }).click();
    await page.waitForURL(/\/admin\/importar\/[a-f0-9-]+$/);
    await expect(page.getByRole('progressbar')).toBeVisible();
    await expect(page.getByRole('status')).toBeVisible();
    await auditarWcagAA(page, 'progreso');
  },
);

test.fixme(
  'TC-621c — resultado: tabla de rechazos y foco en el encabezado, sin violaciones',
  async ({ page }) => {
    // Bloqueado por el mismo defecto: sin POST exitoso no hay pantalla de
    // resultado que auditar.
    await login(page);
    await page.goto('/admin/importar');
    await expect(
      page.getByRole('heading', { name: 'Importación terminada' }),
    ).toBeFocused();
    await auditarWcagAA(page, 'resultado');
  },
);
