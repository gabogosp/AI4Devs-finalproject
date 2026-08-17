import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const BOOTSTRAP = process.env.ADMIN_BOOTSTRAP_TOKEN || 'qa-bootstrap';

async function login(page: Page): Promise<void> {
  await page.goto('/admin/acceso');
  await page.getByLabel(/Token de acceso/).fill(BOOTSTRAP);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL(/\/admin\/productos/);
}

async function auditWcagAA(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();
  expect(results.violations).toEqual([]);
}

test('a11y — /acceso (WCAG AA, sin violaciones)', async ({ page }) => {
  await page.goto('/admin/acceso');
  await auditWcagAA(page);
});

test('a11y — /productos (listado)', async ({ page }) => {
  await login(page);
  await page.goto('/admin/productos');
  await expect(page.getByRole('heading', { name: 'Productos' })).toBeVisible();
  await auditWcagAA(page);
});

test('a11y — /categorias', async ({ page }) => {
  await login(page);
  await page.goto('/admin/categorias');
  await expect(page.getByRole('heading', { name: 'Categorías' })).toBeVisible();
  await auditWcagAA(page);
});

test('a11y — /productos/nuevo (formulario)', async ({ page }) => {
  await login(page);
  await page.goto('/admin/productos/nuevo');
  await expect(page.getByRole('heading', { name: 'Nuevo producto' })).toBeVisible();
  await auditWcagAA(page);
});
