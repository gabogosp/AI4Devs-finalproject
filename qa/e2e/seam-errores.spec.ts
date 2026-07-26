import { test, expect, type Page } from '@playwright/test';

const BOOTSTRAP = process.env.ADMIN_BOOTSTRAP_TOKEN || 'qa-bootstrap';

// Login REAL por la página /acceso (X-6 desbloqueado por backend Fase 9).
async function login(page: Page): Promise<void> {
  await page.goto('/acceso');
  await page.getByLabel(/Token de acceso/).fill(BOOTSTRAP);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL(/\/productos/);
}

async function pickCategory(page: Page): Promise<void> {
  const select = page.getByLabel(/Categoría/);
  await expect(select).toBeVisible();
  // La primera opción real (índice 1; la 0 es "Elegí una categoría").
  const value = await select.locator('option').nth(1).getAttribute('value');
  await select.selectOption(value!);
}

test.describe('Costura FE↔BE contra la API real', () => {
  test('TC-020: login real por /acceso → panel visible', async ({ page }) => {
    await login(page);
    await expect(page.getByRole('heading', { name: 'Productos' })).toBeVisible();
  });

  test('TC-021: SKU duplicado → 409 mapeado a banner (AC-9)', async ({ page }) => {
    await login(page);
    const sku = `E2E-${Date.now()}`;
    // Alta 1 (ok)
    await page.goto('/productos/nuevo');
    await page.getByLabel(/SKU/).fill(sku);
    await page.getByLabel(/Nombre/).fill('Heladera E2E');
    await page.getByLabel(/Precio/).fill('1000');
    await page.getByLabel(/Stock/).fill('3');
    await pickCategory(page);
    await page.getByRole('button', { name: /Crear en borrador/ }).click();
    await expect(page.getByText(/Creado en borrador/)).toBeVisible();
    // Alta 2 con el mismo SKU → 409 → banner
    await page.goto('/productos/nuevo');
    await page.getByLabel(/SKU/).fill(sku);
    await page.getByLabel(/Nombre/).fill('Duplicada');
    await page.getByLabel(/Precio/).fill('2000');
    await page.getByLabel(/Stock/).fill('1');
    await pickCategory(page);
    await page.getByRole('button', { name: /Crear en borrador/ }).click();
    // AC-9 exige banner **y** error en el campo. El FE renderiza los dos como
    // `role="alert"`, así que se asertan ambos explícitamente en vez de un
    // `getByText` ambiguo (que rompe el strict mode de Playwright al matchear 2).
    const alertas = page
      .getByRole('alert')
      .filter({ hasText: /Ya existe un producto con ese SKU/ });
    await expect(alertas).toHaveCount(2);
    await expect(alertas.first()).toBeVisible();
  });

  test('TC-022: sin sesión admin → redirige a /acceso (AC-8)', async ({ page }) => {
    await page.goto('/productos');
    await page.waitForURL(/\/acceso/);
    await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible();
  });

  test('TC-024: validación por campo se muestra inline (AC-5)', async ({ page }) => {
    await login(page);
    await page.goto('/productos/nuevo');
    await page.getByLabel(/SKU/).fill(`E2E-${Date.now()}`);
    await page.getByLabel(/Precio/).fill('0'); // inválido
    await pickCategory(page);
    await page.getByRole('button', { name: /Crear en borrador/ }).click();
    await expect(page.getByText('El nombre es requerido')).toBeVisible();
    await expect(page.getByText('El precio debe ser mayor a 0')).toBeVisible();
  });
});
