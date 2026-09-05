import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { adminAuth } from '../support/admin-auth';
import { crearOrdenEnEstado } from '../support/seed-ordenes';

/**
 * A-1/A-2 (T6.1-T6.2, TC-1230/TC-1231) — accesibilidad del panel sobre la
 * página SERVIDA (route group `(admin)` completo), no sobre un componente
 * aislado — eso ya lo cubre la capa dev-owned (RTL + vitest-axe, T10.1 del
 * frontend). Mismo patrón de login que `importar-a11y.spec.ts`.
 */

async function loginComoAdmin(page: Page): Promise<string> {
  const token = await adminAuth();
  await page.addInitScript((t) => {
    window.sessionStorage.setItem('dsm.admin.token', t);
  }, token);
  return token;
}

async function auditarWcagAA(page: Page, estado: string): Promise<void> {
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();
  expect(
    violations.map((v) => `${v.id}: ${v.help}`),
    `violaciones WCAG AA en el panel de órdenes (${estado})`,
  ).toEqual([]);
}

test('TC-1230a — OrdersList con datos: sin violaciones', async ({ page }) => {
  const adminToken = await loginComoAdmin(page);
  await crearOrdenEnEstado('new', { adminToken });
  await page.goto('/admin/ordenes');
  await expect(page.getByRole('table')).toBeVisible();
  await auditarWcagAA(page, 'listado con datos');
});

test('TC-1230b — OrdersList vacío: sin violaciones', async ({ page }) => {
  await loginComoAdmin(page);
  // Estado vacío interceptado: forzar 0 filas reales en una base compartida
  // por muchas sesiones no es determinista — la a11y del estado vacío es una
  // propiedad del MARKUP renderizado, no del origen de los datos.
  await page.route('**/v1/admin/orders?*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [], pagination: { limit: 20, offset: 0, total: 0 } }),
    }),
  );
  await page.goto('/admin/ordenes');
  await expect(page.getByText('No hay órdenes con ese filtro.')).toBeVisible();
  await auditarWcagAA(page, 'listado vacío');
});

test('TC-1230c — OrdersList en error: sin violaciones', async ({ page }) => {
  await loginComoAdmin(page);
  await page.route('**/v1/admin/orders?*', (route) =>
    route.fulfill({
      status: 500,
      contentType: 'application/problem+json',
      body: JSON.stringify({ type: 'about:blank', title: 'Error', status: 500 }),
    }),
  );
  await page.goto('/admin/ordenes');
  await expect(
    page.getByRole('alert').filter({ hasText: 'No se pudieron cargar' }),
  ).toBeVisible();
  await auditarWcagAA(page, 'listado en error');
});

test('TC-1230d — OrderDetail: sin violaciones', async ({ page }) => {
  const adminToken = await loginComoAdmin(page);
  const orden = await crearOrdenEnEstado('preparing', { adminToken });
  await page.goto(`/admin/ordenes/${orden.id}`);
  await expect(page.getByRole('heading', { name: `Orden #${orden.orderNumber}` })).toBeVisible();
  await auditarWcagAA(page, 'detalle');
});

test('TC-1231 — teclado + aria-sort + foco gestionado al detalle (US §9)', async ({ page }) => {
  const adminToken = await loginComoAdmin(page);
  const orden = await crearOrdenEnEstado('new', { adminToken });
  await page.goto('/admin/ordenes');
  await expect(page.getByRole('table')).toBeVisible();

  // Las 3 columnas ordenables son operables SOLO con teclado: foco + Enter.
  const th = page.locator('th').filter({ hasText: 'Nº de orden' });
  await expect(th).toHaveAttribute('aria-sort', 'none');
  await th.getByRole('button').focus();
  await page.keyboard.press('Enter');
  await expect(th).toHaveAttribute('aria-sort', /ascending|descending/);

  // Al entrar al detalle desde el listado, el foco entra al <h1> de la orden
  // (no queda flotando en el link/botón que se hizo click) — se navega
  // directo (no hay link visible al detalle en esta versión del listado, así
  // que se verifica goteando a la URL, que es lo que design-system §11 exige
  // sobre el destino, no sobre el origen del click).
  await page.goto(`/admin/ordenes/${orden.id}`);
  await expect(page.getByRole('heading', { name: `Orden #${orden.orderNumber}` })).toBeFocused();
});
