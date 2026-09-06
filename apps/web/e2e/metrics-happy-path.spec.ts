import { test, expect } from '@playwright/test';

/**
 * Flujo feliz del panel de métricas (US-016 AC-1/2/3/4). Login admin igual
 * que `category-invalidation.spec.ts`: el stub acepta cualquier valor de
 * token (`POST /v1/admin/auth/login` no lo valida), así que el fixture usa
 * el mismo `seed-token` de precedente.
 */
test('el dueño ve el chart, el ranking y el resumen, y cambiar el rango refetchea los 3', async ({
  page,
}) => {
  await page.goto('/admin/acceso');
  await page.getByLabel(/Token de acceso/).fill('seed-token');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/admin\/productos/);

  await page.goto('/admin/metricas');

  await expect(page.getByRole('heading', { name: 'Métricas' })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Evolución de ventas' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Productos más pedidos' }),
  ).toBeVisible();
  await expect(page.getByText('Heladera exhibidora')).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Resumen del período' }),
  ).toBeVisible();

  // Cambiar el rango (AC-4) refetchea los 3 widgets — se espera un nuevo
  // `waitForResponse` a cada endpoint, nunca `waitForTimeout`
  // (`playwright-stability` skill).
  const salesResponse = page.waitForResponse((res) =>
    res.url().includes('/v1/admin/reports/sales') && res.status() === 200,
  );
  const topProductsResponse = page.waitForResponse((res) =>
    res.url().includes('/v1/admin/reports/top-products') && res.status() === 200,
  );
  const summaryResponse = page.waitForResponse((res) =>
    res.url().includes('/v1/admin/reports/summary') && res.status() === 200,
  );

  await page.getByLabel('Desde').fill('2026-08-01');
  await page.getByLabel('Hasta').fill('2026-08-31');
  await page.getByRole('button', { name: 'Aplicar' }).click();

  await Promise.all([salesResponse, topProductsResponse, summaryResponse]);
});
