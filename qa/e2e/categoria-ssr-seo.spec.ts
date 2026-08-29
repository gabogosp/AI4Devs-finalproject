import { test, expect } from '@playwright/test';
import { seedCategorias, type SeedCategorias } from '../support/seed-categorias';

/**
 * TC-201..TC-208 — Layer 3: la navegación por categorías contra el **stack
 * real** (FE servido + API viva + Postgres sembrado), no contra un stub.
 *
 * Diferencia con el smoke dev-owned de `apps/web/e2e/`: aquél corre contra
 * `api-stub.mjs` con datos fijos y es la red de seguridad del dev. Éste
 * ejercita el contrato real con datos sembrados por la API respetando la
 * máquina de estado — es lo único que detecta una divergencia entre lo que el
 * backend devuelve y lo que el FE asume.
 *
 * Las aserciones de SEO van sobre el **body de la respuesta HTTP**, nunca sobre
 * el DOM hidratado: un buscador no ejecuta JavaScript, así que asertar el DOM
 * daría verde aunque el contenido llegara sólo por hidratación. Y las de status
 * van sobre `response.status()`, que es lo único que distingue un 404 real de
 * un soft-200 — la página renderizada se ve igual en ambos casos.
 */

let seed: SeedCategorias;

test.beforeAll(async () => {
  seed = await seedCategorias();
});

test('TC-201: el rubro se sirve por slug y muestra subrubros y productos (AC-1)', async ({
  page,
}) => {
  const res = await page.goto(`/categorias/${seed.rubro.slug}`);
  expect(res?.status()).toBe(200);

  // El rubro AGREGA los productos de sus hijos (regla D-1 del backend). Se busca
  // en las DOS páginas: el listado se ordena alfabéticamente por nombre, no por
  // orden de creación, así que un producto concreto puede caer en cualquiera.
  // Assertar contra un índice del seed sería asumir un orden que nadie garantiza.
  const htmlRubro =
    (await res!.text()) +
    (await (await page.goto(`/categorias/${seed.rubro.slug}?page=2`))!.text());

  const delSubrubro = seed.publicados[0].name;
  expect(htmlRubro).toContain(delSubrubro);
  expect(htmlRubro).toContain(seed.enRubro.name);

  await page.goto(`/categorias/${seed.rubro.slug}`);

  // NO se asserta que el NOMBRE del subrubro aparezca acá: hoy sólo lo muestra
  // el `CategoryNav` del layout, cuyo árbol se cachea 300 s, y sembrar por la
  // API **no** invalida el caché del frontend (la invalidación está cableada a
  // la UI del panel). Assertarlo sería una carrera contra el TTL. El AC-1 dice
  // «subrubros **y/o** productos», así que la agregación ya lo satisface.
  // Ver observación OBS-1 del reporte.

  // AC-1 pide URL amigable: slug, nunca el uuid.
  expect(page.url()).toContain(`/categorias/${seed.rubro.slug}`);
  expect(page.url()).not.toContain(seed.rubro.id);
});

test('TC-202: el subrubro lista sólo lo propio y pagina sin recargar el catálogo (AC-2/AC-3)', async ({
  page,
}) => {
  const PAGE_SIZE = 20;
  const TOTAL_EN_SUBRUBRO = seed.publicados.length + 1; // + el sin stock

  const primera = await page.goto(`/categorias/${seed.subrubro.slug}`);
  expect(primera?.status()).toBe(200);

  // El hijo NO agrega hacia arriba: lo que cuelga del padre no aparece acá.
  expect(await primera!.text()).not.toContain(seed.enRubro.name);

  // Se cuentan ENLACES A FICHA, no nombres concretos: la aserción no depende del
  // orden del listado, sólo del tamaño de página.
  //
  // Se sondea con re-navegación en vez de assertar una sola vez: entre el seed y
  // el primer render hay una ventana en la que el SSR todavía sirve el listado
  // cacheado (sembrar por la API **no** invalida el caché del frontend — la
  // invalidación está cableada a la UI del panel). No es un `waitForTimeout`
  // disfrazado: si el dato no aparece nunca, el sondeo agota y falla.
  const contarFichas = async (url: string): Promise<number> => {
    await page.goto(url);
    return page.locator('a[href^="/productos/"]').count();
  };
  const base = `/categorias/${seed.subrubro.slug}`;

  await expect
    .poll(() => contarFichas(base), {
      timeout: 15_000,
      message: 'la página 1 nunca mostró una página completa de productos',
    })
    .toBe(PAGE_SIZE);

  // La página 2 trae el resto y es una URL propia (enlazable e indexable).
  await expect
    .poll(() => contarFichas(`${base}?page=2`), {
      timeout: 15_000,
      message: 'la página 2 nunca mostró los productos restantes',
    })
    .toBe(TOTAL_EN_SUBRUBRO - PAGE_SIZE);

  expect((await page.goto(`${base}?page=2`))?.status()).toBe(200);
});

test('TC-203: cada categoría trae metadatos propios, no los del sitio (AC-4)', async ({
  page,
}) => {
  const res = await page.goto(`/categorias/${seed.subrubro.slug}`);
  const html = await res!.text();

  // El title debe identificar a ESTA categoría: si fuera el genérico del sitio,
  // todas las páginas competirían entre sí por el mismo término.
  expect(html).toContain(`<title>`);
  expect(html).toMatch(
    new RegExp(`<title>[^<]*${escapeRegExp(seed.subrubro.name)}[^<]*</title>`),
  );
  expect(html).toMatch(/<meta name="description"[^>]*content="[^"]+"/);
});

test('TC-204: el sitemap cubre el catálogo y no anuncia URLs muertas (AC-4)', async ({
  page,
  request,
}) => {
  const res = await page.goto('/sitemap.xml');
  expect(res?.status()).toBe(200);
  const xml = await res!.text();

  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  expect(locs.length).toBeGreaterThan(0);

  // La home entra: es la raíz del árbol de navegación.
  expect(locs.some((u) => new URL(u).pathname === '/')).toBe(true);

  // Absolutas y del mismo origen: un sitemap con URLs relativas o apuntando a
  // localhost desde producción es inútil para un buscador. Este assert es el
  // que atraparía el modo de falla de `NEXT_PUBLIC_SITE_URL` sin definir en el
  // paso de build del pipeline.
  const origen = new URL(page.url()).origin;
  for (const u of locs) {
    expect(u).toMatch(/^https?:\/\//);
    expect(new URL(u).origin).toBe(origen);
  }

  // Ninguna URL anunciada puede estar muerta: una entrada que devuelve 404 es
  // una promesa rota al crawler y castiga el dominio entero.
  for (const u of locs) {
    const r = await request.get(u);
    expect(r.status(), `el sitemap anuncia ${u} y responde ${r.status()}`).toBe(200);
  }

  // Y ninguna categoría inexistente puede aparecer.
  expect(xml).not.toContain('/categorias/no-existe-jamas');

  // NO se asserta que la categoría recién sembrada figure acá: el catálogo se
  // cachea 3600 s y sembrar por la API **no** invalida el frontend (la
  // invalidación está cableada a la UI del panel). Esperar el TTL no es una
  // prueba, es una espera de una hora. Que una publicación nueva llegue al
  // sitemap lo cubre el E2E de invalidación, que muta por el panel — el camino
  // real. Ver OBS-2 del reporte.
});

test('TC-206: el HTML servido no contiene draft ni archivados (AC-8)', async ({
  page,
}) => {
  for (const slug of [seed.rubro.slug, seed.subrubro.slug]) {
    const res = await page.goto(`/categorias/${slug}`);
    const html = await res!.text();

    // Negative space: lo no publicado no se filtra ni siquiera en el HTML, que
    // es lo que un scraper leería aunque la UI no lo muestre.
    expect(html).not.toContain(seed.draft.name);
    expect(html).not.toContain(seed.archivado.name);
    expect(html).not.toContain(seed.draft.sku);
  }
});

test('TC-207: una categoría inexistente responde 404 real (AC-9)', async ({ page }) => {
  const res = await page.goto('/categorias/no-existe-jamas');

  // Si fuera 200, Google indexaría una página de error como contenido válido.
  expect(res?.status()).toBe(404);

  // Y una página fuera de rango también: la página 99 de una categoría con 2
  // no existe, y servir un vacío en 200 genera páginas fantasma.
  const fuera = await page.goto(`/categorias/${seed.subrubro.slug}?page=99`);
  expect(fuera?.status()).toBe(404);
});

test('TC-208: el listado ya está en el HTML servido, sin ejecutar JavaScript (AC-10)', async ({
  browser,
}) => {
  // Contexto con JS deshabilitado: es la aproximación más fiel a lo que ve un
  // crawler que no hidrata.
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();

  const res = await page.goto(`/categorias/${seed.subrubro.slug}`);
  expect(res?.status()).toBe(200);

  const html = await res!.text();
  expect(html).toContain(seed.publicados[0].name);
  // El precio llega formateado, no en centavos crudos.
  expect(html).not.toContain(String(seed.publicados[0].price_ars_cents));

  await context.close();
});

test('TC-205b: un producto sin stock se lista pero no ofrece comprar (AC-5)', async ({
  page,
}) => {
  const res = await page.goto(`/categorias/${seed.subrubro.slug}`);
  const html = await res!.text();

  expect(html).toContain(seed.sinStock.name);
  expect(html).toContain('Sin stock');

  // Cada producto enlaza a su ficha (AC-3): la card ES el link.
  await expect(
    page.getByRole('link', { name: new RegExp(escapeRegExp(seed.sinStock.name)) }),
  ).toBeVisible();

  // ACTUALIZADO por US-007 T3.5 (OQ-FE-2 resuelta por el PO como «sí»): desde el
  // carrito, la card CON stock ofrece «Agregar». Lo que sigue valiendo —y es lo que
  // AC-5 afirma— es que la card SIN stock no ofrece comprar: el assert se acota a
  // esa card en vez de negar el botón en toda la página, que era la lectura válida
  // mientras el carrito no existía.
  const cardSinStock = page
    .locator('article')
    .filter({ hasText: seed.sinStock.name });
  await expect(cardSinStock.getByRole('button', { name: /Agregar/i })).toHaveCount(0);
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
