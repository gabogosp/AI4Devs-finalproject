import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { seedCategorias, type SeedCategorias } from '../support/seed-categorias';

/**
 * TC-220 / TC-221 — accesibilidad de la página de categoría (WCAG 2.1 AA,
 * US-002 §9).
 *
 * Se auditan las **dos variantes** a propósito: la categoría con productos es
 * el caso feliz, y la vacía es donde la a11y suele romperse, porque un estado
 * vacío mal construido deja la página sin encabezado ni salida navegable.
 *
 * TC-221 cubre lo que axe **no** puede ver: axe audita el árbol accesible de lo
 * que está en el DOM, pero no prueba que un teclado alcance los controles ni
 * que el foco sea visible al llegar. Una página puede tener 0 violaciones y ser
 * inoperable sin mouse.
 */

/** Selector de lo que el browser pone en el orden de tabulación. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Tabula hasta el elemento y devuelve si el foco llegó.
 *
 * Cuenta primero cuántos focusables lo preceden en el DOM y tabula esa cantidad
 * exacta, en vez de tabular a ciegas con un presupuesto fijo. Motivo: la barra
 * de rubros lista **todas** las categorías de la base, y en un entorno de
 * desarrollo compartido eso son decenas — un presupuesto fijo fallaba por la
 * cantidad de datos y no por la accesibilidad, que es un falso rojo.
 *
 * La prueba sigue siendo real: si el elemento estuviera fuera del orden de
 * tabulación (`tabindex="-1"`, oculto, o un `div` con `onClick` en vez de un
 * link), el conteo no aterrizaría en él y el assert fallaría.
 */
async function tabularHasta(page: Page, selector: string): Promise<boolean> {
  const pasos = await page.evaluate(
    ({ sel, focusable }) => {
      const objetivo = document.querySelector(sel);
      if (!objetivo) return -1;
      const todos = Array.from(document.querySelectorAll(focusable));
      const i = todos.indexOf(objetivo as Element);
      return i === -1 ? -1 : i + 1;
    },
    { sel: selector, focusable: FOCUSABLE },
  );
  if (pasos < 0) return false;

  for (let i = 0; i < pasos; i += 1) await page.keyboard.press('Tab');
  return page.evaluate((sel) => document.activeElement === document.querySelector(sel), selector);
}

async function auditarWcagAA(page: Page, donde: string): Promise<void> {
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();

  expect(
    violations.map((v) => `${v.id}: ${v.help}`),
    `violaciones WCAG AA en ${donde}`,
  ).toEqual([]);
}

let seed: SeedCategorias;

test.beforeAll(async () => {
  seed = await seedCategorias();
});

test.describe('TC-220 — axe-core sobre las variantes de la categoría', () => {
  test('categoría con productos: 0 violaciones AA', async ({ page }) => {
    await page.goto(`/categorias/${seed.subrubro.slug}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    await auditarWcagAA(page, 'la categoría con productos');
  });

  test('categoría vacía: 0 violaciones AA', async ({ page }) => {
    await page.goto(`/categorias/${seed.vacia.slug}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    await auditarWcagAA(page, 'la categoría vacía');
  });

  test('rubro con subrubros y grilla paginada: 0 violaciones AA', async ({ page }) => {
    // El rubro suma la nav de subrubros y la paginación a la grilla: es la
    // variante con más controles y por lo tanto la de mayor superficie a11y.
    await page.goto(`/categorias/${seed.rubro.slug}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    await auditarWcagAA(page, 'el rubro con subrubros y paginación');
  });
});

test.describe('TC-221 — operable sólo con teclado', () => {
  test('el árbol rubro → subrubro se recorre y activa con Tab/Enter', async ({ page }) => {
    await page.goto(`/categorias/${seed.rubro.slug}`);

    const selector = `nav[aria-label="Subrubros"] a[href$="/categorias/${seed.subrubro.slug}"]`;
    const alSubrubro = page.locator(selector);
    await expect(alSubrubro).toBeVisible();

    // Si el link estuviera fuera del orden de foco —`tabindex="-1"`, oculto, o
    // un div con onClick— el conteo no aterrizaría en él. axe no ve nada de eso.
    expect(
      await tabularHasta(page, selector),
      'el link al subrubro no es alcanzable con Tab',
    ).toBe(true);

    // Foco VISIBLE al llegar: un foco alcanzable pero invisible deja al
    // usuario de teclado sin saber dónde está (WCAG 2.4.7).
    const anillo = await alSubrubro.evaluate((el) => {
      const s = getComputedStyle(el);
      return `${s.outlineStyle}|${s.outlineWidth}|${s.boxShadow}`;
    });
    expect(
      anillo === 'none|0px|none',
      `el link enfocado no muestra indicador visible (outline/box-shadow: ${anillo})`,
    ).toBe(false);

    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/categorias/${seed.subrubro.slug}$`));
  });

  test('los controles de paginación se alcanzan y activan con teclado', async ({ page }) => {
    await page.goto(`/categorias/${seed.subrubro.slug}`);

    const selector = 'nav[aria-label="Paginación"] a[rel="next"]';
    await expect(page.locator(selector)).toBeVisible();

    expect(
      await tabularHasta(page, selector),
      '"Siguiente" no es alcanzable con Tab',
    ).toBe(true);

    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/[?&]page=2/);
  });

  test('el orden de foco sigue el orden visual: nav → contenido → paginación', async ({
    page,
  }) => {
    await page.goto(`/categorias/${seed.subrubro.slug}`);

    // Se compara la POSICIÓN en el orden de tabulación en vez de tabular hasta
    // el final: la barra de rubros aporta decenas de paradas en un entorno
    // compartido, y recorrerlas no agrega señal sobre el orden.
    const orden = await page.evaluate((focusable) => {
      const zonas = Array.from(document.querySelectorAll(focusable)).map((el) => {
        const nav = el.closest('nav');
        return nav?.getAttribute('aria-label') ?? 'contenido';
      });
      return {
        primerProducto: zonas.indexOf('contenido'),
        primeraPaginacion: zonas.indexOf('Paginación'),
      };
    }, FOCUSABLE);

    expect(orden.primeraPaginacion, 'la paginación no está en el orden de tabulación').toBeGreaterThan(-1);
    expect(
      orden.primerProducto,
      'no hay ningún control de contenido en el orden de tabulación',
    ).toBeGreaterThan(-1);
    // La paginación va DESPUÉS de la grilla: llegar a "Siguiente" antes que a
    // los productos obliga a tabular de vuelta para leer lo que se está
    // paginando.
    expect(
      orden.primerProducto < orden.primeraPaginacion,
      'el foco alcanza la paginación antes que la grilla',
    ).toBe(true);
  });
});
