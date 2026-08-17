import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { seedFichaPublica, type SeedFicha } from '../support/seed-ficha';

/**
 * TC-320 — accesibilidad de la ficha pública (WCAG 2.1 AA, US-003 §9).
 *
 * Se auditan las **dos variantes** a propósito. La ficha con imagen es el caso
 * feliz; la que usa placeholder es donde la a11y se rompe en la práctica,
 * porque un placeholder sin nombre accesible deja al lector de pantalla sin
 * nada que anunciar — y el `alt` descriptivo es requisito explícito del AC-6.
 */

async function auditarWcagAA(page: Page): Promise<void> {
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();

  // Mensaje útil al fallar: axe devuelve objetos grandes y el diff crudo no
  // dice qué arreglar.
  expect(
    violations.map((v) => `${v.id}: ${v.help}`),
    'violaciones WCAG AA en la ficha',
  ).toEqual([]);
}

let seed: SeedFicha;

test.beforeAll(async () => {
  seed = await seedFichaPublica();
});

test('TC-320a: la ficha con imagen no tiene violaciones AA', async ({ page }) => {
  await page.goto(`/productos/${seed.publicado.slug}`);
  await auditarWcagAA(page);
});

test('TC-320b: la ficha con placeholder no tiene violaciones AA', async ({
  page,
}) => {
  await page.goto(`/productos/${seed.sinImagen.slug}`);
  await auditarWcagAA(page);
});

test('TC-320c: la ficha sin stock comunica el estado con texto, no sólo color', async ({
  page,
}) => {
  await page.goto(`/productos/${seed.sinStock.slug}`);
  await auditarWcagAA(page);

  // WCAG 1.4.1: el color nunca puede ser el único portador de significado. El
  // estado tiene que estar escrito, no sólo pintado — axe no lo detecta.
  await expect(page.getByText('Sin stock', { exact: true })).toBeVisible();
});
