import { Given, Then, When } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { seedFichaPublica, type SeedFicha } from '../../support/seed-ficha';
import { CatalogWorld } from './world';

/**
 * TC-310..TC-314 — aceptación de la ficha pública contra el stack real.
 *
 * Nivel UI a propósito: estos AC hablan de lo que el **cliente ve** (indicador
 * de stock, acción de compra, canal de contacto, texto alternativo). Asertarlos
 * contra el JSON de la API probaría otra cosa — eso ya lo cubre la TDD del dev.
 */

interface Estado {
  seed: SeedFicha;
  respuestas: Array<{ status: number; html: string }>;
}

function estado(w: CatalogWorld): Estado {
  return w.state as unknown as Estado;
}

Given('un catálogo sembrado con productos en todos sus estados', async function (
  this: CatalogWorld,
) {
  estado(this).seed = await seedFichaPublica();
  estado(this).respuestas = [];
});

async function abrir(w: CatalogWorld, slug: string): Promise<void> {
  const page = await w.visitar(`/productos/${slug}`);
  const res = await page.reload();
  estado(w).respuestas.push({
    status: res?.status() ?? 0,
    html: (await res?.text()) ?? '',
  });
}

When('un visitante abre la ficha del producto publicado', async function (
  this: CatalogWorld,
) {
  await abrir(this, estado(this).seed.publicado.slug);
});

When('un visitante abre la ficha del producto sin stock', async function (
  this: CatalogWorld,
) {
  await abrir(this, estado(this).seed.sinStock.slug);
});

When('un visitante abre la ficha del producto sin imagen', async function (
  this: CatalogWorld,
) {
  await abrir(this, estado(this).seed.sinImagen.slug);
});

When('un visitante abre la ficha del producto en borrador', async function (
  this: CatalogWorld,
) {
  await abrir(this, estado(this).seed.draft.slug);
});

When('un visitante abre la ficha de un identificador inexistente', async function (
  this: CatalogWorld,
) {
  await abrir(this, 'no-existe-jamas-acceptance');
});

Then('ve su nombre y su precio en pesos', async function (this: CatalogWorld) {
  const { seed } = estado(this);
  await expect(
    this.page!.getByRole('heading', { name: seed.publicado.name }),
  ).toBeVisible();
  await expect(this.page!.getByText(/\$\s?[\d.]+/)).toBeVisible();
});

Then('ve el indicador de disponibilidad {string}', async function (
  this: CatalogWorld,
  texto: string,
) {
  await expect(this.page!.getByText(texto, { exact: false })).toBeVisible();
});

Then('ve el indicador {string}', async function (
  this: CatalogWorld,
  texto: string,
) {
  // Exacto a propósito: el copy del canal de contacto empieza con "Sin stock
  // por ahora…", así que un match laxo rompería por strict-mode sin que haya
  // nada mal en la página.
  await expect(this.page!.getByText(texto, { exact: true })).toBeVisible();
});

Then('se ofrece la acción de agregar al carrito', async function (
  this: CatalogWorld,
) {
  const boton = this.page!.getByRole('button', { name: /Agregar al carrito/i });
  await expect(boton).toBeVisible();
  // AC-3 pide que la acción se OFREZCA: un botón deshabilitado no la ofrece
  // (decisión D-2 — va activo contra el seam que US-007 reemplaza).
  await expect(boton).toBeEnabled();
});

Then('no se ofrece la acción de agregar al carrito', async function (
  this: CatalogWorld,
) {
  const boton = this.page!.getByRole('button', { name: /Agregar al carrito/i });
  // Puede no existir, o existir deshabilitado — lo que NO puede es ser
  // accionable con stock cero.
  if (await boton.count()) {
    await expect(boton).toBeDisabled();
  }
});

Then('se ofrece el canal de contacto para consultar', async function (
  this: CatalogWorld,
) {
  const contacto = this.page!.getByRole('link', {
    name: /WhatsApp|Consultar|Contact/i,
  });
  await expect(contacto.first()).toBeVisible();
});

Then('la imagen mostrada tiene un texto alternativo descriptivo', async function (
  this: CatalogWorld,
) {
  const { seed } = estado(this);
  // El placeholder de AC-6 es un div con `role="img"`, no un `<img>`:
  // `getByRole` cubre ambos casos y es lo que ve un lector de pantalla.
  const img = this.page!.getByRole('img').first();
  await expect(img).toBeVisible();
  const nombre =
    (await img.getAttribute('alt')) ??
    (await img.getAttribute('aria-label')) ??
    '';
  expect(nombre.length, 'la imagen necesita nombre accesible').toBeGreaterThan(0);
  // Descriptivo = habla del producto, no "imagen" o "placeholder" a secas.
  expect(nombre).toContain(seed.sinImagen.name);
});

Then('el resto de la ficha se renderiza normalmente', async function (
  this: CatalogWorld,
) {
  const { seed } = estado(this);
  await expect(
    this.page!.getByRole('heading', { name: seed.sinImagen.name }),
  ).toBeVisible();
});

Then('ambas respuestas son 404 con el mismo mensaje', function (
  this: CatalogWorld,
) {
  const [draft, inexistente] = estado(this).respuestas;
  expect(draft.status).toBe(404);
  expect(inexistente.status).toBe(404);

  const titulo = (h: string) => h.match(/<title>(.*?)<\/title>/)?.[1] ?? '';
  expect(titulo(draft.html)).toBe(titulo(inexistente.html));
});

Then('ninguna revela el nombre del producto no publicado', function (
  this: CatalogWorld,
) {
  const { seed, respuestas } = estado(this);
  for (const r of respuestas) {
    expect(r.html).not.toContain(seed.draft.name);
  }
});
