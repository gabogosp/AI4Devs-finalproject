import { test, expect } from '@playwright/test';
import { seedFichaPublica, type SeedFicha } from '../support/seed-ficha';

/**
 * TC-301..TC-306 — Layer 3: la ficha pública contra el **stack real**
 * (FE servido + API viva + Postgres sembrado), no contra un stub.
 *
 * Diferencia con el smoke dev-owned de `apps/web/e2e/pdp-ssr.spec.ts`: aquél
 * corre contra `e2e/support/api-stub.mjs` con datos fijos y es la red de
 * seguridad del dev. Éste ejercita el contrato real, con datos sembrados por la
 * API respetando la máquina de estado — es lo único que detecta una divergencia
 * entre lo que el backend devuelve y lo que el FE asume.
 *
 * Todas las aserciones de SEO van sobre el **body de la respuesta HTTP**, nunca
 * sobre el DOM hidratado: un buscador no ejecuta JavaScript, así que asertar el
 * DOM daría verde aunque el contenido llegara sólo por hidratación.
 */

const BOOTSTRAP = process.env.ADMIN_BOOTSTRAP_TOKEN ?? 'seed-token';

let seed: SeedFicha;

test.beforeAll(async () => {
  seed = await seedFichaPublica();
});

test('TC-301: la ficha de un producto publicado muestra sus datos (AC-1)', async ({
  page,
}) => {
  const res = await page.goto(`/productos/${seed.publicado.slug}`);
  expect(res?.status()).toBe(200);

  // Datos visibles para el cliente.
  await expect(
    page.getByRole('heading', { name: seed.publicado.name }),
  ).toBeVisible();
  await expect(page.getByText(/\$/)).toBeVisible();

  // AC-1 pide URL amigable: el slug, no el sku ni el uuid (decisión D-1).
  expect(page.url()).toContain(`/productos/${seed.publicado.slug}`);
  expect(page.url()).not.toContain(seed.publicado.sku);
  expect(page.url()).not.toContain(seed.publicado.id);
});

test('TC-302: el HTML servido ya trae el contenido, sin hidratar (AC-2/AC-10)', async ({
  page,
}) => {
  const res = await page.goto(`/productos/${seed.publicado.slug}`);
  const html = await res!.text();

  // Si esto falla, la página se arma en el cliente y Google la ve vacía.
  expect(html).toContain(seed.publicado.name);

  // El precio llega formateado, no en centavos crudos.
  expect(html).not.toContain(String(seed.publicado.price_ars_cents));
});

test('TC-303: el HTML trae JSON-LD Product y metadatos propios (AC-2)', async ({
  page,
}) => {
  const res = await page.goto(`/productos/${seed.publicado.slug}`);
  const html = await res!.text();

  const bloque = html.match(
    /<script type="application\/ld\+json"[^>]*>(.*?)<\/script>/s,
  );
  expect(bloque, 'la ficha debe emitir un bloque JSON-LD').not.toBeNull();

  const ld = JSON.parse(bloque![1]);
  expect(ld['@type']).toBe('Product');
  expect(ld.name).toBe(seed.publicado.name);
  expect(ld.sku).toBe(seed.publicado.sku);
  expect(ld.offers.priceCurrency).toBe('ARS');
  expect(ld.offers.availability).toBe('https://schema.org/InStock');

  // Los metadatos son del producto, no genéricos del sitio.
  const title = html.match(/<title>(.*?)<\/title>/)?.[1] ?? '';
  expect(title).toContain(seed.publicado.name);
});

test('TC-304: draft, archivado e inexistente dan 404 sin filtrar contenido (AC-7/AC-8)', async ({
  page,
}) => {
  const casos: Array<[string, string]> = [
    ['draft', seed.draft.slug],
    ['archivado', seed.archivado.slug],
    ['inexistente', 'no-existe-jamas-qa'],
  ];

  const cuerpos: string[] = [];
  for (const [etiqueta, slug] of casos) {
    const res = await page.goto(`/productos/${slug}`);
    expect(res?.status(), `${etiqueta} debe dar 404`).toBe(404);
    cuerpos.push(await res!.text());
  }

  // El HTML del 404 no puede filtrar el producto que existe pero no está publicado.
  expect(cuerpos[0]).not.toContain(seed.draft.name);
  expect(cuerpos[1]).not.toContain(seed.archivado.name);

  // Negative-space del negative-space: los tres 404 son indistinguibles, así que
  // nadie puede enumerar el catálogo no publicado comparando respuestas.
  //
  // Se compara la propiedad observable —mismo título y mismo copy visible— y no
  // el HTML completo: Next inyecta una key de React distinta por render, así que
  // una comparación byte-a-byte fallaría por ruido y no por una fuga real.
  const titulo = (h: string) => h.match(/<title>(.*?)<\/title>/)?.[1] ?? '';
  const copy = 'No encontramos este producto';

  for (const cuerpo of cuerpos) {
    expect(titulo(cuerpo)).toBe(titulo(cuerpos[2]));
    expect(cuerpo).toContain(copy);
    expect(cuerpo).toContain('name="robots" content="noindex"');
  }
});

test('TC-305: editar el precio en el panel refresca la ficha sin esperar (AC-9)', async ({
  page,
}) => {
  const slug = seed.publicado.slug;

  // Precio único por corrida: si fuera fijo y una corrida previa lo hubiera
  // dejado cacheado, el assert final pasaría sin que la invalidación hiciera
  // nada — un falso verde en el único test que cubre AC-9.
  const nuevoPesos = 7000 + (Date.now() % 900);
  const formateado = new Intl.NumberFormat('es-AR').format(nuevoPesos);

  // 1) Poblar la caché con un precio que NO es el que vamos a poner.
  const antes = await page.goto(`/productos/${slug}`);
  expect(antes!.status()).toBe(200);
  expect(await antes!.text()).not.toContain(formateado);

  // 2) Editar DESDE LA UI DEL PANEL: ése es el camino que dispara la Server
  //    Action de revalidación. Un PATCH por API directa no invalida nada — sólo
  //    lo cubriría el TTL de 1 h, y el test daría verde sin probar el circuito.
  await page.goto('/admin/acceso');
  await page.getByLabel(/Token de acceso/).fill(BOOTSTRAP);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/admin\/productos/);

  await page.goto(`/admin/productos/${seed.publicado.id}`);
  await page.getByLabel(/Precio/).fill(String(nuevoPesos));

  // Esperar la confirmación del PATCH: la edición no muestra mensaje de éxito
  // (llama a `revalidateProductSafely` y sigue), así que la señal observable es
  // la respuesta de la API — no un `waitForTimeout`.
  const [patch] = await Promise.all([
    page.waitForResponse(
      (r) =>
        r.request().method() === 'PATCH' &&
        r.url().includes('/v1/admin/products/'),
    ),
    page.getByRole('button', { name: /Guardar/ }).click(),
  ]);
  expect(patch.ok(), 'el guardado del panel debe responder 200').toBe(true);

  // 3) La ficha pública debe traer el precio nuevo POR la invalidación. Se
  //    reintenta unos segundos porque la Server Action es asíncrona, pero eso
  //    NO debilita la prueba: la caché dura 1 h, así que si `revalidateProduct`
  //    no corriera, ningún reintento la haría pasar.
  await expect
    .poll(
      async () => {
        const res = await page.goto(`/productos/${slug}`);
        return await res!.text();
      },
      { timeout: 10_000, message: 'la ficha nunca mostró el precio nuevo' },
    )
    .toContain(formateado);
});

test('TC-306: la ficha carga dentro del presupuesto de LCP (NFR)', async ({
  page,
}) => {
  const LCP_BUDGET_MS = 2500; // NFR de US-003 §9.

  await page.goto(`/productos/${seed.publicado.slug}`);
  const lcp = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        new PerformanceObserver((list) => {
          const e = list.getEntries();
          resolve(e[e.length - 1].startTime);
        }).observe({ type: 'largest-contentful-paint', buffered: true });
        setTimeout(() => resolve(0), 5000);
      }),
  );

  expect(lcp, 'no se pudo medir LCP').toBeGreaterThan(0);
  expect(lcp).toBeLessThan(LCP_BUDGET_MS);
});
