import { test, expect } from '@playwright/test';

/**
 * Estado vacío del panel de métricas (AC-5): un rango sin órdenes muestra el
 * mensaje de estado vacío en los 3 widgets, nunca un `role="alert"` de error.
 *
 * El stub trata cualquier `created_at_from` del año 2000 como "sin datos"
 * (convención local del fixture, `e2e/support/api-stub.mjs`).
 */
test('un rango sin órdenes muestra el estado vacío en los 3 widgets, sin ningún error', async ({
  page,
}) => {
  await page.goto('/admin/acceso');
  await page.getByLabel(/Token de acceso/).fill('seed-token');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/admin\/productos/);

  await page.goto('/admin/metricas');
  await expect(
    page.getByRole('heading', { name: 'Evolución de ventas' }),
  ).toBeVisible();

  const salesResponse = page.waitForResponse((res) =>
    res.url().includes('/v1/admin/reports/sales') && res.status() === 200,
  );
  const topProductsResponse = page.waitForResponse((res) =>
    res.url().includes('/v1/admin/reports/top-products') && res.status() === 200,
  );
  const summaryResponse = page.waitForResponse((res) =>
    res.url().includes('/v1/admin/reports/summary') && res.status() === 200,
  );

  await page.getByLabel('Desde').fill('2000-01-01');
  await page.getByLabel('Hasta').fill('2000-01-31');
  await page.getByRole('button', { name: 'Aplicar' }).click();

  await Promise.all([salesResponse, topProductsResponse, summaryResponse]);

  await expect(page.getByText('No hay ventas registradas en este período.')).toBeVisible();
  await expect(
    page.getByText('No hay productos pedidos en este período.'),
  ).toBeVisible();
  await expect(
    page.getByText('No hay órdenes registradas en este período.'),
  ).toBeVisible();

  // `getByRole('alert')` también matchea `__next-route-announcer__` — un
  // elemento visualmente oculto que Next.js inyecta en TODA página App
  // Router para accesibilidad de navegación, siempre vacío. Se filtra por
  // texto no vacío: lo que importa es que ningún alert **de error** esté
  // visible, no la ausencia total del rol.
  await expect(page.getByRole('alert').filter({ hasText: /.+/ })).toHaveCount(0);
});
