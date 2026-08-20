import { test, expect, request as playwrightRequest } from '@playwright/test';

const STUB = `http://localhost:${process.env.API_STUB_PORT ?? 4010}`;

/**
 * AC-1, AC-3, AC-4, AC-6, AC-9 y AC-10 sobre la respuesta **del servidor**.
 *
 * Todos los asserts van contra `response.status()` y el body servido, nunca
 * contra el DOM hidratado. Motivo: una aserción de DOM **no puede distinguir un
 * 404 real de un soft-200** — la página renderizada se ve idéntica en ambos
 * casos, y ésa es exactamente la diferencia que AC-9 exige. `page.route`
 * tampoco sirve acá: el fetch es server-side.
 */
/**
 * Este spec **no resetea nada**: sólo lee. Un reset acá revertiría el fixture
 * de un spec de mutación corriendo en paralelo (`fullyParallel`) en medio de su
 * aserción — que es exactamente el flake que costó encontrar. Sólo resetea
 * quien muta.
 */

test('una categoría con contenido: 200 + subrubros + productos + JSON-LD en el HTML servido', async ({
  page,
}) => {
  const res = await page.goto('/categorias/climatizacion');

  expect(res!.status()).toBe(200);
  const html = await res!.text();

  expect(html).toContain('Compresores E2E'); // subrubro (AC-1)
  expect(html).toContain('Compresor E2E 1'); // producto en el HTML (AC-10)
  expect(html).toContain('BreadcrumbList'); // datos estructurados (AC-4)
});

test('una categoría inexistente devuelve 404 REAL, no un soft-200', async ({ page }) => {
  const res = await page.goto('/categorias/no-existe-jamas');

  // Si hubiera un `loading.tsx` en el segmento o en el route group, Next
  // transmitiría el shell con 200 ya comprometido y esto daría 200 (F59).
  expect(res!.status()).toBe(404);
});

test('una página fuera de rango devuelve 404, no una página fantasma indexable', async ({
  page,
}) => {
  const res = await page.goto('/categorias/compresores-e2e?page=99');

  expect(res!.status()).toBe(404);
});

test('una page malformada se normaliza a 1 y responde 200', async ({ page }) => {
  const res = await page.goto('/categorias/compresores-e2e?page=abc');

  expect(res!.status()).toBe(200);
  expect(await res!.text()).toContain('Compresor E2E 1');
});

test('una categoría existente sin productos: 200 con estado vacío navegable (AC-6)', async ({
  page,
}) => {
  const res = await page.goto('/categorias/vacia-e2e');

  expect(res!.status()).toBe(200);
  const html = await res!.text();
  expect(html).toContain('Todavía no hay productos publicados');
  expect(html).toContain('Ver todos los rubros');
});

test('AC-7: el servidor nunca pide más de 20 ítems, y la página 2 pide offset=20', async ({
  page,
}) => {
  await page.goto('/categorias/compresores-e2e?page=2');

  const reqCtx = await playwrightRequest.newContext();
  const log: { url: string }[] = await (await reqCtx.get(`${STUB}/__requests`)).json();
  await reqCtx.dispose();

  // Contra el LOG del stub y no contra el DOM: contar 20 tarjetas pasaría
  // igual aunque el servidor se hubiera traído las 5.000 y mostrara 20.
  //
  // El log es acumulativo de toda la corrida y no se limpia: limpiarlo crearía
  // una carrera con los specs que corren en paralelo. Las dos aserciones son
  // monótonas, así que arrastrar requests ajenos no las debilita — al
  // contrario, `every` cubre TODO lo que el servidor pidió en la corrida.
  const urls = log.map((r) => r.url).join('\n');
  // Se asserta sobre el texto del log para que el fallo MUESTRE qué pidió el
  // servidor, en vez de un `false` mudo.
  expect(urls).toContain('offset=20');

  // La GRILLA pide exactamente 20. El sitemap (T5.2) es el único otro consumidor
  // del endpoint y pagina de a 100 —el máximo del contrato— legítimamente: no es
  // una superficie de usuario y pedirle de a 20 quintuplicaría sus requests. Se
  // lo excluye por su `limit`, y a cambio se asserta abajo el techo duro.
  const grilla = log.filter(
    (r) => r.url.includes('/products?') && !r.url.includes('limit=100'),
  );
  expect(grilla.length).toBeGreaterThan(0);
  expect(grilla.every((r) => r.url.includes('limit=20'))).toBe(true);

  // Techo duro: NADA supera el máximo del contrato. Es la garantía de fondo de
  // AC-7 — el catálogo completo no puede viajar en una sola respuesta.
  expect(log.every((r) => !/limit=(10[1-9]|1[1-9]\d|[2-9]\d\d|\d{4,})/.test(r.url))).toBe(
    true,
  );
});
