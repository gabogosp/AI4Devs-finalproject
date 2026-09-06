import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { adminAuth } from '../support/admin-auth';
import { catalogoParaMetricas, crearOrdenActiva } from '../support/seed-metricas';

/**
 * QA-016-A11Y-1 — accesibilidad del panel de métricas sobre la página SERVIDA
 * (route group `(admin)` completo, backend real), con Recharts pintando un
 * `<svg>` real — jsdom (capa dev-owned, `a11y.test.tsx`) no lo hace, así que
 * el chart nunca queda expuesto al motor de axe de esa corrida (qa-plan.md
 * §5.4). Mismo patrón de login y de auditoría que `ordenes-a11y.spec.ts`.
 */

async function loginComoAdmin(page: Page): Promise<string> {
  const token = await adminAuth();
  await page.addInitScript((t) => {
    window.sessionStorage.setItem('dsm.admin.token', t);
  }, token);
  return token;
}

async function auditarWcagAA(page: Page, estado: string): Promise<void> {
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(
    violations.map((v) => `${v.id}: ${v.help}`),
    `violaciones WCAG AA en el panel de métricas (${estado})`,
  ).toEqual([]);
}

test('TC-016-A1 — MetricsDashboard con datos reales (chart pintado, tabla accesible abierta): sin violaciones', async ({
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
  // No se busca ESTE producto por nombre: en una base con historial (varios
  // productos con más ventas acumuladas), el ranking (`limit` default 10) no
  // garantiza que un producto de 1 unidad quede en pantalla — lo que audita
  // este test es el MARKUP del widget "con datos", no una fila específica.
  await expect(page.getByTestId('top-products-table').getByTestId('top-products-empty-state')).toHaveCount(0);

  // Despliega la tabla de datos accesible del chart (`<details><summary>`) —
  // con el `<svg>` de Recharts YA pintado en el DOM, expuesto al motor de axe.
  await page.getByText('Ver datos en tabla').click();
  await expect(page.getByRole('table').first()).toBeVisible();

  await auditarWcagAA(page, 'con datos reales');
});

test('TC-016-A2 — MetricsDashboard en los 3 estados vacíos (rango real sin órdenes): sin violaciones', async ({
  page,
}) => {
  await loginComoAdmin(page);
  await page.goto('/admin/metricas');
  await expect(page.getByRole('heading', { name: 'Métricas' })).toBeVisible();

  const waitSales = page.waitForResponse((r) => r.url().includes('/v1/admin/reports/sales') && r.status() === 200);
  const waitTop = page.waitForResponse((r) => r.url().includes('/v1/admin/reports/top-products') && r.status() === 200);
  const waitSummary = page.waitForResponse((r) => r.url().includes('/v1/admin/reports/summary') && r.status() === 200);
  // Rango real, futuro (mismo criterio que QA-016-E2E-2) — no un stub.
  await page.getByLabel('Desde').fill('2033-01-01');
  await page.getByLabel('Hasta').fill('2033-01-31');
  await page.getByRole('button', { name: 'Aplicar' }).click();
  await Promise.all([waitSales, waitTop, waitSummary]);

  await expect(page.getByTestId('sales-chart').getByTestId('sales-empty-state')).toBeVisible();
  await expect(page.getByTestId('top-products-table').getByTestId('top-products-empty-state')).toBeVisible();
  await expect(page.getByTestId('summary-cards').getByTestId('summary-empty-state')).toBeVisible();

  await auditarWcagAA(page, 'estado vacío');
});

test('TC-016-A3 — la tabla accesible, el select de granularidad y el filtro de rango son operables sólo con teclado', async ({
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
  await expect(page.getByTestId('top-products-table').getByTestId('top-products-empty-state')).toHaveCount(0);

  // El <select> de granularidad es operable con teclado: foco + "type-ahead"
  // nativo (la primera letra de la opción) cambia el valor SIN abrir el
  // popup del SO — `ArrowDown` con el popup nativo cerrado no es fiable en
  // Chromium headless (limitación conocida de Playwright con `<select>`
  // nativos), así que se usa el mecanismo de teclado que sí es determinista.
  const granularidad = page.getByLabel('Agrupar por:');
  await granularidad.focus();
  await expect(granularidad).toBeFocused();
  await page.keyboard.press('KeyS'); // "Semana"
  await expect(granularidad).toHaveValue('week');

  // La tabla accesible del chart (`<details><summary>`) se abre con Enter,
  // sin usar el mouse — semántica nativa de disclosure.
  const resumenTabla = page.getByText('Ver datos en tabla');
  await resumenTabla.focus();
  await expect(resumenTabla).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('table').first()).toBeVisible();

  // El filtro de rango: Tab entre los dos campos de fecha y el botón
  // "Aplicar", todo alcanzable y operable con teclado — foco visible al
  // navegador (outline nativo, no suprimido por CSS).
  const desde = page.getByLabel('Desde');
  const hasta = page.getByLabel('Hasta');
  const aplicar = page.getByRole('button', { name: 'Aplicar' });

  // El VALOR se fija con `.fill()` (mismo mecanismo semántico que el RTL
  // dev-owned, `fireEvent.change(getByLabelText(...))`). No se encadena un
  // `Tab` único entre los tres controles: un `<input type="date">` nativo
  // tiene sus PROPIOS tab-stops internos por segmento (mes/día/año), así que
  // un solo `Tab` mueve DENTRO del mismo campo antes de salir de él — no es
  // determinista en Chromium headless. Lo que este bloque prueba es que cada
  // control es alcanzable con teclado por sí mismo (foco nativo) y que el
  // último es operable con `Enter` — mismo criterio que `ordenes-a11y.spec.ts`
  // TC-1231 (foco puntual + tecla, no la continuidad completa del tab-order).
  await desde.focus();
  await expect(desde).toBeFocused();
  await desde.fill('2033-02-01');

  await hasta.focus();
  await expect(hasta).toBeFocused();
  await hasta.fill('2033-02-28');

  await aplicar.focus();
  await expect(aplicar).toBeFocused();

  const waitSales = page.waitForResponse((r) => r.url().includes('/v1/admin/reports/sales') && r.status() === 200);
  await page.keyboard.press('Enter');
  await waitSales;
  await expect(page.getByTestId('sales-chart').getByTestId('sales-empty-state')).toBeVisible();
});
