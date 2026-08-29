import { test, expect } from '@playwright/test';
import { seedBusqueda } from '../support/seed-busqueda';

/**
 * QA-004-E2E-1/E2E-2 — búsqueda semántica cross-stack (US-004, Layer 3: cruza
 * el change backend y el change frontend-web).
 *
 * Locators por rol/texto (playwright-stability): el input es `role="searchbox"`
 * vía `aria-label="Buscar productos"` (SearchBar.tsx), sin selectores frágiles
 * de clase/DOM. Sin `waitForTimeout`: la navegación real a `/buscar?q=...` es la
 * señal de espera.
 *
 * Siembra su propio fixture en `beforeAll` (`seed-busqueda.ts`) en vez de asumir
 * un catálogo ambiente: el entorno de QA de este change es compartido entre
 * sesiones/corridas concurrentes que resetean `products` como parte de su
 * propio ciclo de vida, así que depender de un producto pre-existente
 * («taco-fischer») resultó flaky en la práctica (2026-08-29).
 */
test.describe('Búsqueda semántica (US-004)', () => {
  let nombreProducto: string;

  test.beforeAll(async () => {
    const { producto } = await seedBusqueda();
    nombreProducto = producto.name;
  });

  test('QA-004-E2E-1 — búsqueda con resultado muestra al menos un producto (AC-1)', async ({ page }) => {
    await page.goto('/');

    const buscador = page.getByRole('searchbox', { name: 'Buscar productos' });
    await buscador.fill(nombreProducto);
    await buscador.press('Enter');

    await expect(page).toHaveURL(/\/buscar\?q=/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(nombreProducto);

    // Al menos un resultado enlaza a su ficha (US-003) con precio visible —
    // AC-1: "cada resultado enlaza a su ficha".
    const primerResultado = page.getByRole('link', { name: new RegExp(nombreProducto, 'i') }).first();
    await expect(primerResultado).toBeVisible();
    await expect(primerResultado).toHaveAttribute('href', /\/productos\//);

    // El precio vive en el mismo card que el link (design.md D6).
    await expect(page.getByText(/\$\s?\d/).first()).toBeVisible();
  });

  test('QA-004-E2E-2 — búsqueda sin señal muestra fallback a categorías, nunca "0 resultados" desnudo (AC-3)', async ({ page }) => {
    await page.goto('/');

    const buscador = page.getByRole('searchbox', { name: 'Buscar productos' });
    await buscador.fill('xyzzy foobar consulta sin sentido');
    await buscador.press('Enter');

    await expect(page).toHaveURL(/\/buscar\?q=/);

    // La red de seguridad de AC-3: siempre hay por dónde seguir. El título es
    // "Mirá estos rubros" en el caso confidence=none (SearchResults.tsx) — el
    // default del componente ("Probá navegando por rubro") no se usa en ningún
    // call site real de la página.
    const fallback = page.getByRole('heading', { name: 'Mirá estos rubros' });
    await expect(fallback).toBeVisible();

    const categoriaSugerida = page.locator('a[data-fallback-slug]').first();
    await expect(categoriaSugerida).toBeVisible();
    await expect(categoriaSugerida).toHaveAttribute('href', /\/categorias\//);
  });
});
