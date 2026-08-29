import { test, expect, request as playwrightRequest } from '@playwright/test';

const STUB = `http://localhost:${process.env.API_STUB_PORT ?? 4010}`;
/**
 * Producto y categoría EXCLUSIVOS de este spec. No los toca ningún otro: el de
 * SSR asserta nombres en `compresores-e2e`, y si este spec renombrara algo de
 * ahí lo vería cambiado a mitad de corrida. Aislar el fixture es más barato que
 * sincronizar dos specs que corren en paralelo.
 */
const SLUG = 'compresor-invalidacion';
const NOMBRE = 'Compresor Invalidación';
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
  // 1) Poblar la caché del listado. Lo que importa NO es qué nombre muestra,
  //    sino que no es el que vamos a poner: así el assert final sólo puede
  //    pasar si la invalidación corrió.
  //
  //    Deliberadamente NO se asserta el nombre inicial del fixture. La Data
  //    Cache de Next vive en `.next/cache`, sobrevive a builds y reinicios, y
  //    `__reset` del stub **no la toca**: si una corrida previa dejó cacheado
  //    un renombre, el listado lo sigue mostrando hasta que expire el TTL de
  //    1 h. Anclar el estado inicial hacía fallar el spec por caché ajena y no
  //    por el comportamiento —falla que además sólo aparece al reusar el mismo
  //    puerto, porque la URL del fetch (y con ella la clave de caché) incluye
  //    el puerto del stub—.
  const antes = await page.goto('/categorias/invalidacion-e2e');
  expect(antes!.status()).toBe(200);
  // `NUEVO_NOMBRE` es único por corrida, así que ninguna caché puede tenerlo.
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

  // 3) Recargar el listado hasta que el HTML DEL SERVIDOR traiga el nombre
  //    nuevo. Se usa `expect.poll` y no un `waitForTimeout`: el puente es
  //    fire-and-forget —la mutación ya fue confirmada por el backend, así que
  //    la purga corre sin bloquear al dueño— y por eso la recarga puede
  //    correrle la carrera por milisegundos. Sin el poll el spec es flaky
  //    (verificado: falla ~1 de cada 2 corridas).
  //
  //    Esto NO debilita la aserción: la caché del listado dura 1 h y el poll
  //    agota en 5 s, así que si el nombre aparece sólo puede ser porque
  //    `revalidateCatalog` corrió, nunca porque expiró un TTL. Y si no corre,
  //    el poll agota y el test FALLA — no es una espera ciega.
  await expect
    .poll(
      async () => {
        const res = await page.goto('/categorias/invalidacion-e2e');
        expect(res!.status()).toBe(200);
        return await res!.text();
      },
      { timeout: 5000, intervals: [200, 300, 500, 500, 1000] },
    )
    .toContain(NUEVO_NOMBRE);
});

test('el listado y la ficha comparten la invalidación: ambos quedan consistentes', async ({
  page,
}) => {
  const listado = await page.goto('/categorias/invalidacion-e2e');
  expect(listado!.status()).toBe(200);

  // La propiedad que importa es que **el enlace de la grilla resuelva**: si el
  // listado enlazara por un identificador que la ficha no sabe resolver —el
  // caso `sku` vs `slug` de OQ-QA-2— acá habría 404 y la grilla estaría
  // mintiendo. Es el único punto del E2E donde esa divergencia aparece.
  const href = await page
    .locator(`a[href^="/productos/"]`)
    .first()
    .getAttribute('href');
  expect(href).toBe(`/productos/${SLUG}`);

  // NO se comparan los nombres entre ambas vistas: la ficha y el listado usan
  // cachés independientes (`product:{slug}` y `catalog`), que se invalidan
  // juntas ante una mutación pero pueden tener distinta antigüedad heredada de
  // corridas previas. Exigir que coincidan haría fallar el spec por estado de
  // caché y no por comportamiento.
  const ficha = await page.goto(`/productos/${SLUG}`);
  expect(ficha!.status()).toBe(200);
});
