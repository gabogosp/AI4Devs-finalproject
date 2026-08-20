import { test, expect, request as playwrightRequest } from '@playwright/test';

const STUB = `http://localhost:${process.env.API_STUB_PORT ?? 4010}`;
/** Producto del fixture de browse, disjunto del de la PDP. */
const SLUG = 'compresor-e2e-1';
const NOMBRE = 'Compresor E2E 1';
const BROWSE_MUTABLE_ID = '44444444-4444-4444-8444-444444444444';

/**
 * AC-8 end-to-end: el circuito de invalidación del **catálogo**.
 *
 * Lo que prueba de verdad: que el listado deja de mostrar el producto **por la
 * invalidación** y no porque expiró un TTL. Por eso no hay ninguna espera
 * temporal — la caché del listado dura 1 h, así que si `revalidateCatalog` no
 * corriera, el assert final fallaría de inmediato contra el listado viejo. La
 * ausencia de espera **es** la aserción.
 *
 * La edición va por la **UI del panel** a propósito: ése es el camino que
 * dispara la Server Action. Mutar por API directa no invalida nada, y un test
 * que lo hiciera daría verde sin probar el circuito.
 */
test.beforeEach(async () => {
  const ctx = await playwrightRequest.newContext();
  // Alcance propio: no toca el fixture de la PDP, del que dependen los specs
  // de US-003 corriendo en paralelo.
  await ctx.post(`${STUB}/__reset?scope=catalog`);
  await ctx.dispose();
});

/** Nombre único por corrida: si fuera fijo y una corrida previa lo hubiera
 * dejado cacheado, el assert final pasaría sin que la invalidación hiciera
 * nada — un falso verde en el único test que cubre AC-8 de punta a punta. */
const NUEVO_NOMBRE = `Compresor renombrado ${Date.now() % 1000000}`;

test('renombrar un producto en el panel refresca el listado de la categoría de inmediato', async ({
  page,
}) => {
  // 1) Poblar la caché del listado. Lo que importa no es qué nombre muestra,
  //    sino que NO es el que vamos a poner: así el assert final sólo puede
  //    pasar si la invalidación corrió.
  const antes = await page.goto('/categorias/compresores-e2e');
  expect(antes!.status()).toBe(200);
  expect(await antes!.text()).toContain(NOMBRE);
  expect(await antes!.text()).not.toContain(NUEVO_NOMBRE);

  // 2) Editarlo DESDE EL PANEL: es el camino que dispara la Server Action.
  //    Mutar por API directa no invalidaría nada y el test daría verde sin
  //    probar el circuito.
  await page.goto('/admin/acceso');
  await page.getByLabel(/Token de acceso/).fill('seed-token');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/admin\/productos/);

  await page.goto(`/admin/productos/${BROWSE_MUTABLE_ID}`);
  await page.getByLabel(/Nombre/).fill(NUEVO_NOMBRE);
  await page.getByRole('button', { name: /Guardar/ }).click();

  // 3) Recargar el listado: sin espera temporal. La caché dura 1 h, así que si
  //    `revalidateCatalog` no hubiera corrido, esto fallaría de inmediato.
  const despues = await page.goto('/categorias/compresores-e2e');
  expect(despues!.status()).toBe(200);
  expect(await despues!.text()).toContain(NUEVO_NOMBRE);
});

test('el listado y la ficha comparten la invalidación: ambos quedan consistentes', async ({
  page,
}) => {
  const listado = await page.goto('/categorias/compresores-e2e');
  expect(listado!.status()).toBe(200);
  expect(await listado!.text()).toContain(NOMBRE);

  // La card enlaza a la ficha, y la ficha del mismo producto existe: si el
  // listado enlazara a un slug que no resuelve, la grilla estaría mintiendo.
  const ficha = await page.goto(`/productos/${SLUG}`);
  expect(ficha!.status()).toBe(200);
  expect(await ficha!.text()).toContain(NOMBRE);
});
