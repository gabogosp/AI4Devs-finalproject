import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { csvFilas, csvMixto } from '../support/import-files';

function sufijo(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

/**
 * TC-621 — accesibilidad de las tres pantallas del import (WCAG 2.1 AA).
 *
 * Selector, progreso y resultado tienen cada una su propia superficie de
 * fallo (`qa-plan.md` §6): el input de archivo + su etiqueta, la barra con
 * `aria-valuenow`/indeterminada + región viva, y la tabla de rechazos con
 * encabezados y paginación.
 *
 * **Progreso y resultado estuvieron bloqueadas** por el mismo defecto real de
 * CORS que TC-617..TC-620 (`idempotency-key` faltante en `allowedHeaders` de
 * `bootstrap.ts` — ver `docs/RUN-MVP.md` §US-006), ya corregido. Las tres
 * corren hoy.
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

test(
  'TC-621b — progreso: barra + región viva anuncian el avance, sin violaciones',
  async ({ page }) => {
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

    // Sólo hay UN import vigente a la vez (409 si hay otro corriendo): sin
    // esperar el cierre acá, TC-621c (el próximo test) puede chocar con este
    // import de 5.000 filas todavía corriendo y nunca llegar a la pantalla
    // de resultado.
    await expect(
      page.getByRole('heading', { name: 'Importación terminada' }),
    ).toBeVisible({ timeout: 30_000 });
  },
);

test(
  'TC-621c — resultado: tabla de rechazos y foco en el encabezado, sin violaciones',
  async ({ page }) => {
    await login(page);
    await page.goto('/admin/importar');
    const { buffer } = csvMixto(sufijo());
    await page
      .locator('#archivo-import')
      .setInputFiles({ name: 'con-rechazos.csv', mimeType: 'text/csv', buffer });
    await page.getByRole('button', { name: 'Importar catálogo' }).click();
    await page.waitForURL(/\/admin\/importar\/[a-f0-9-]+$/);
    await expect(
      page.getByRole('heading', { name: 'Importación terminada' }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByRole('heading', { name: 'Importación terminada' }),
    ).toBeFocused();
    await auditarWcagAA(page, 'resultado');
  },
);
