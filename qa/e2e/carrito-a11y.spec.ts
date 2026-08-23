import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { seedCarrito, type SeedCarrito } from '../support/seed-carrito';
import { adminAuth } from '../support/admin-auth';
import { apiCall } from '../support/api';

/**
 * TC-730 — accesibilidad del carrito (WCAG 2.1 AA, US-007 §9).
 *
 * Se auditan las **tres** variantes que esta US produce, y la tercera es la que
 * importa más: el carrito con una línea bloqueada suma badge, motivo en texto,
 * acciones extra y un CTA deshabilitado con explicación — es la mayor superficie y
 * donde la a11y se rompe en la práctica. Auditar sólo el caso feliz dejaría eso sin
 * mirar.
 */

async function auditarWcagAA(page: Page, variante: string): Promise<void> {
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();

  expect(
    violations.map((v) => `${v.id}: ${v.help}`),
    `violaciones WCAG AA en el carrito (${variante})`,
  ).toEqual([]);
}

async function agregar(page: Page, slug: string): Promise<void> {
  await page.goto(`/productos/${slug}`);
  await page.getByRole('button', { name: /agregar al carrito/i }).click();
  await expect(page.getByRole('status')).toContainText(/agregaste/i);
}

let seed: SeedCarrito;

test.beforeAll(async () => {
  seed = await seedCarrito();
});

test('TC-730a: el carrito con ítems no tiene violaciones AA', async ({ page }) => {
  await agregar(page, seed.mixtoA.slug);
  await page.goto('/carrito');
  await expect(page.getByRole('listitem').filter({ hasText: seed.mixtoA.name })).toBeVisible();

  await auditarWcagAA(page, 'con ítems');
});

test('TC-730b: el carrito vacío no tiene violaciones AA', async ({ page }) => {
  await page.goto('/carrito');
  await expect(page.getByRole('heading', { name: /carrito está vacío/i })).toBeVisible();

  await auditarWcagAA(page, 'vacío');
});

test('TC-730c: el carrito con una línea bloqueada no tiene violaciones AA', async ({
  page,
}) => {
  // Dos líneas: una comprable y una que se va a bloquear. El `draft` NO se usa acá
  // —su ficha es un 404 por AC-10— y la línea bloqueada se produce como en la vida
  // real: despublicando algo que ya estaba en el carrito.
  await agregar(page, seed.mixtoB.slug);
  await agregar(page, seed.paraDespublicar.slug);
  const token = await adminAuth();
  await apiCall(`/v1/admin/products/${seed.paraDespublicar.id}`, 'PATCH', token, {
    status: 'archived',
  });

  await page.goto('/carrito');
  const bloqueada = page
    .getByRole('listitem')
    .filter({ hasText: seed.paraDespublicar.name });
  await expect(bloqueada).toContainText(/ya no está disponible/i);

  // La variante de mayor superficie: badge + motivo + acciones + CTA deshabilitado
  // con explicación, todo junto en la misma pantalla.
  await auditarWcagAA(page, 'con línea bloqueada');
});
