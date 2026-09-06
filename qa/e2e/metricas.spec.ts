import { readFile } from 'node:fs/promises';
import { test, expect, type Page } from '@playwright/test';
import { adminAuth } from '../support/admin-auth';
import {
  catalogoParaMetricas,
  crearOrdenActiva,
  crearOrdenCanceladaPorStock,
  crearOrdenPendiente,
  backdatearCreatedAt,
} from '../support/seed-metricas';
import { nuevaCuenta } from '../support/customer-auth';

/**
 * QA-016-E2E-1..5 — panel de métricas cross-stack, backend + frontend REALES
 * (`qa/scripts/api-up.sh` + `pnpm --filter @dsm/web build && start`), dataset
 * sembrado 100% por API real (`seed-metricas.ts`). Distinto del E2E smoke
 * dev-owned (`apps/web/e2e/metrics-*.spec.ts`, contra `api-stub.mjs`, sin
 * backend real) — ver qa-plan.md §5.3.
 *
 * Login admin igual que `ordenes.spec.ts`/`importar-a11y.spec.ts`: token real
 * de `admin-auth.ts` inyectado en `sessionStorage` (mecanismo actual de
 * `adminSession.ts`).
 */

const ARS = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  maximumFractionDigits: 0,
});

/** Mismos dígitos que `formatArs` del FE, sin el símbolo — evita depender de
 * si el espacio entre "$" y el número es normal o NBSP entre Node y Chromium. */
function arsDigits(cents: number): string {
  return Math.round(cents / 100).toLocaleString('es-AR');
}

async function loginComoAdmin(page: Page): Promise<string> {
  const token = await adminAuth();
  await page.addInitScript((t) => {
    window.sessionStorage.setItem('dsm.admin.token', t);
  }, token);
  return token;
}

function esperarReportesOk(page: Page, endpoint: string) {
  return page.waitForResponse((r) => r.url().includes(`/v1/admin/reports/${endpoint}`) && r.status() === 200);
}

// ─── QA-016-E2E-1 (H-1/H-2/X-1) ─────────────────────────────────────────────

test('metricas dataset real — el dashboard cuenta sólo las 4 órdenes activas de X-1 y recalcula al cambiar el rango', async ({
  page,
}) => {
  const adminToken = await loginComoAdmin(page);

  // Mismo dataset que X-1 de aceptación (§4.4): 3 productos, [0]/[1]
  // compartidos por A-E, [2] EXCLUSIVO de F (baja su stock a 0).
  const catalogo = await catalogoParaMetricas(3, { token: adminToken });
  const p0 = catalogo.productos[0]!;
  const p1 = catalogo.productos[1]!;
  const p2 = catalogo.productos[2]!;
  const itemP0 = (qty: number) => [
    { slug: p0.slug, quantity: qty, priceArsCents: p0.price_ars_cents, productName: p0.name, productId: p0.id },
  ];
  const itemP1 = (qty: number) => [
    { slug: p1.slug, quantity: qty, priceArsCents: p1.price_ars_cents, productName: p1.name, productId: p1.id },
  ];
  const itemP2 = (qty: number) => [
    { slug: p2.slug, quantity: qty, priceArsCents: p2.price_ars_cents, productName: p2.name, productId: p2.id },
  ];

  await crearOrdenPendiente({ adminToken, catalogo, items: itemP0(1) }); // A — pending_payment
  const b = await crearOrdenActiva('new', { adminToken, catalogo, items: itemP0(1) });
  const c = await crearOrdenActiva('preparing', { adminToken, catalogo, items: itemP1(2) });
  const d = await crearOrdenActiva('ready', { adminToken, catalogo, items: itemP0(1) });
  const e = await crearOrdenActiva('delivered', { adminToken, catalogo, items: itemP1(1) });
  await crearOrdenCanceladaPorStock({ adminToken, catalogo, items: itemP2(1) }); // F — cancelled

  const totalEsperado = b.totalArsCents + c.totalArsCents + d.totalArsCents + e.totalArsCents;

  await page.goto('/admin/metricas');
  await expect(page.getByRole('heading', { name: 'Métricas' })).toBeVisible();

  const summary = page.getByTestId('summary-cards');
  const topProducts = page.getByTestId('top-products-table');

  // AC-8: orders_count=4 (no 6) y el monto es exactamente B+C+D+E.
  await expect(summary.getByText('4', { exact: true })).toBeVisible();
  await expect(summary.getByText(new RegExp(arsDigits(totalEsperado)))).toBeVisible();

  // El ranking sólo cuenta B/C/D/E: p0=2 (B+D), p1=3 (C+E), p2 (sólo F) ausente.
  await expect(topProducts.getByText(p2.name)).toHaveCount(0);
  const filaP0 = topProducts.getByRole('row').filter({ hasText: p0.name });
  const filaP1 = topProducts.getByRole('row').filter({ hasText: p1.name });
  await expect(filaP0.getByRole('cell').nth(2)).toHaveText('2');
  await expect(filaP1.getByRole('cell').nth(2)).toHaveText('3');

  // Cambiar el rango (RangeFilterForm real) dispara los 3 fetch reales y
  // recalcula — acá a un rango futuro, sin datos (AC-4/AC-5).
  const waitSales = esperarReportesOk(page, 'sales');
  const waitTop = esperarReportesOk(page, 'top-products');
  const waitSummary = esperarReportesOk(page, 'summary');
  await page.getByLabel('Desde').fill('2031-01-01');
  await page.getByLabel('Hasta').fill('2031-01-31');
  await page.getByRole('button', { name: 'Aplicar' }).click();
  await Promise.all([waitSales, waitTop, waitSummary]);

  await expect(summary.getByTestId('summary-empty-state')).toBeVisible();
});

// ─── QA-016-E2E-2 (C-1) ─────────────────────────────────────────────────────

test('metricas vacio real — un rango real sin órdenes muestra el estado vacío sin error', async ({
  page,
}) => {
  await loginComoAdmin(page);
  await page.goto('/admin/metricas');
  await expect(page.getByRole('heading', { name: 'Métricas' })).toBeVisible();

  const waitSales = esperarReportesOk(page, 'sales');
  const waitTop = esperarReportesOk(page, 'top-products');
  const waitSummary = esperarReportesOk(page, 'summary');
  // Rango real, futuro — no un stub que "trata cualquier fecha como vacía"
  // (qa-plan.md §5.3): la ausencia de datos es de verdad, contra Postgres real.
  await page.getByLabel('Desde').fill('2032-01-01');
  await page.getByLabel('Hasta').fill('2032-01-31');
  await page.getByRole('button', { name: 'Aplicar' }).click();
  await Promise.all([waitSales, waitTop, waitSummary]);

  await expect(page.getByTestId('sales-chart').getByTestId('sales-empty-state')).toBeVisible();
  await expect(page.getByTestId('top-products-table').getByTestId('top-products-empty-state')).toBeVisible();
  await expect(page.getByTestId('summary-cards').getByTestId('summary-empty-state')).toBeVisible();
  // Ninguno de los 3 widgets entra en su estado de error (`role="alert"` con
  // texto) — se excluye el anunciador de rutas de Next.js
  // (`#__next-route-announcer__`, también `role="alert"` pero ajeno a los
  // widgets, mismo criterio que `ordenes.spec.ts` TC-1223).
  await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toHaveCount(0);
});

// ─── QA-016-E2E-3 (H-3) ─────────────────────────────────────────────────────

test('metricas descarga csv real — el botón Descargar CSV dispara una descarga real con contenido correcto', async ({
  page,
}) => {
  const adminToken = await loginComoAdmin(page);
  const catalogo = await catalogoParaMetricas(1, { token: adminToken });
  const p = catalogo.productos[0]!;
  await crearOrdenActiva('new', {
    adminToken,
    catalogo,
    items: [{ slug: p.slug, quantity: 1, priceArsCents: p.price_ars_cents, productName: p.name, productId: p.id }],
  });

  await page.goto('/admin/metricas');
  await expect(page.getByRole('heading', { name: 'Métricas' })).toBeVisible();
  await expect(page.getByTestId('top-products-table').getByText(p.name)).toBeVisible();

  // Valor mostrado por SummaryCards en este momento — el CSV descargado debe
  // coincidir exactamente con él (no un valor hardcodeado en el test).
  const ordersCountMostrado = await page
    .getByText('Órdenes', { exact: true })
    .locator('xpath=following-sibling::p[1]')
    .textContent();

  for (const testId of ['sales-chart', 'top-products-table', 'summary-cards'] as const) {
    const widget = page.getByTestId(testId);
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      widget.getByRole('button', { name: 'Descargar CSV' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.csv$/);
    const rutaDescarga = await download.path();
    expect(rutaDescarga).toBeTruthy();
    const contenido = await readFile(rutaDescarga!, 'utf8');
    expect(contenido.trim().length).toBeGreaterThan(0);

    if (testId === 'top-products-table') {
      expect(contenido).toContain(p.name);
    }
    if (testId === 'summary-cards') {
      const filaTotal = contenido.trim().split('\n').at(-1)!;
      const [, countCsv] = filaTotal.split(',');
      expect(countCsv).toBe(ordersCountMostrado);
    }
  }
});

// ─── QA-016-E2E-4 (N-1) ─────────────────────────────────────────────────────

test('metricas sin sesion — sin sesión de admin no se ve el panel', async ({ page }) => {
  // Sin loginComoAdmin: sessionStorage vacío.
  await page.goto('/admin/metricas');
  await page.waitForURL(/\/admin\/acceso/);
  await expect(page.getByRole('heading', { name: 'Acceso al panel' })).toBeVisible();
});

test('metricas sin sesion — una cuenta de cliente real tampoco ve el panel', async ({ page }) => {
  // Sesión real de cliente (US-014, login real vía API) — el guard del FE
  // (`AdminGuard`/`adminSession.ts`) sólo mira `dsm.admin.token` en
  // `sessionStorage`; una sesión válida de OTRO tipo (cookies de cliente) no
  // la satisface. La autoridad real es el backend (probada en N-1 de
  // aceptación); acá se prueba que el FE tampoco muestra el panel de UI.
  const sesion = await nuevaCuenta('-e2e-metricas-n1');
  const estado = await sesion.ctx.storageState();
  expect(estado.cookies.find((c) => c.name === 'dsm_access')).toBeTruthy();
  await sesion.ctx.dispose();

  await page.goto('/admin/metricas');
  await page.waitForURL(/\/admin\/acceso/);
  await expect(page.getByRole('heading', { name: 'Acceso al panel' })).toBeVisible();
});

// ─── QA-016-E2E-5 (C-2) ─────────────────────────────────────────────────────

test('metricas rango acotado — una orden real backdateada a 13 meses muestra la nota de rango acotado', async ({
  page,
}) => {
  const adminToken = await loginComoAdmin(page);
  const catalogo = await catalogoParaMetricas(1, { token: adminToken });
  const p = catalogo.productos[0]!;
  const orden = await crearOrdenActiva('new', {
    adminToken,
    catalogo,
    items: [{ slug: p.slug, quantity: 1, priceArsCents: p.price_ars_cents, productName: p.name, productId: p.id }],
  });
  // Única excepción documentada (qa-plan.md §6): ningún endpoint fija
  // `created_at` — necesaria para que la nota de acotado tenga algo real que
  // señalar (una orden fuera de la ventana de retención vigente).
  const hace13meses = new Date();
  hace13meses.setMonth(hace13meses.getMonth() - 13);
  await backdatearCreatedAt(orden.id, hace13meses);

  await page.goto('/admin/metricas');
  await expect(page.getByRole('heading', { name: 'Métricas' })).toBeVisible();

  const waitSales = esperarReportesOk(page, 'sales');
  const hace24meses = new Date();
  hace24meses.setMonth(hace24meses.getMonth() - 24);
  await page.getByLabel('Desde').fill(hace24meses.toISOString().slice(0, 10));
  await page.getByLabel('Hasta').fill(new Date().toISOString().slice(0, 10));
  await page.getByRole('button', { name: 'Aplicar' }).click();
  await waitSales;

  await expect(page.getByText(/Mostrando desde/).first()).toBeVisible();
});
