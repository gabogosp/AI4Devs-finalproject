import { test, expect, request as playwrightRequest } from '@playwright/test';

const STUB = `http://localhost:${process.env.API_STUB_PORT ?? 4010}`;
const SLUG = 'ventilador-de-techo';
const PRODUCT_ID = '33333333-3333-4333-8333-333333333333';

/**
 * AC-9 end-to-end: el circuito completo de invalidación on-demand.
 *
 * Lo que prueba de verdad: que el precio nuevo aparece **por la invalidación** y
 * no porque expiró un TTL. Por eso no hay ninguna espera temporal — la caché de
 * la ficha dura 1 h, así que si `revalidateProduct` no corriera, el assert final
 * fallaría de inmediato contra el precio viejo. (Verificado quitando la llamada
 * del flujo del panel: el spec falla.)
 *
 * La edición va **por la UI del panel** a propósito: ése es el camino que
 * dispara la Server Action. Editar por API directa no invalida nada (eso sólo lo
 * cubre el safety-net de 1 h), y un test que lo hiciera daría verde sin probar
 * nada.
 *
 * El precio nuevo es **único por corrida**: si fuera fijo y una corrida anterior
 * lo hubiera dejado en la caché, el assert final pasaría sin que la invalidación
 * hiciera nada — un falso verde en el único test que cubre AC-9.
 */
const NUEVO_PESOS = 9000 + (Date.now() % 900);
const NUEVO_FORMATEADO = `${Math.floor(NUEVO_PESOS / 1000)}.${String(
  NUEVO_PESOS % 1000,
).padStart(3, '0')}`;

test.beforeEach(async () => {
  // El stub guarda estado en memoria y este spec lo muta: sin reset, una
  // segunda corrida arrancaría del precio ya cambiado.
  const ctx = await playwrightRequest.newContext();
  // Alcance `pdp`: sin él, este reset borraría también el fixture de browse de
  // US-002 y, con `fullyParallel`, le revertiría los datos a un spec ajeno en
  // medio de su aserción (T7.2 de US-002).
  await ctx.post(`${STUB}/__reset?scope=pdp`);
  await ctx.dispose();
});

test('editar el precio en el panel refresca la ficha pública de inmediato', async ({
  page,
}) => {
  // 1) Poblar la caché de la ficha. Lo que importa no es qué precio muestra,
  //    sino que NO es el que vamos a poner: así el assert final sólo puede
  //    pasar si la invalidación corrió.
  const before = await page.goto(`/productos/${SLUG}`);
  expect(before!.status()).toBe(200);
  expect(await before!.text()).not.toContain(NUEVO_FORMATEADO);

  // 2) Editar el precio desde el panel.
  await page.goto('/admin/acceso');
  await page.getByLabel(/Token de acceso/).fill('seed-token');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/admin\/productos/);

  await page.goto(`/admin/productos/${PRODUCT_ID}`);
  await page.getByLabel(/Precio/).fill(String(NUEVO_PESOS));
  await page.getByRole('button', { name: /Guardar/ }).click();

  // 3) Recargar hasta que el HTML del servidor traiga el precio nuevo.
  //
  //    `expect.poll` y no una espera fija: el puente es fire-and-forget —la
  //    mutación ya fue confirmada por el backend, así que la purga corre sin
  //    bloquear al dueño— y la recarga puede ganarle por milisegundos. Desde
  //    US-002 el puente purga DOS cachés (ficha y catálogo), lo que ensancha
  //    esa ventana y hacía fallar este spec ~1 de cada 3 corridas en paralelo.
  //
  //    No debilita la aserción: la caché dura 1 h y el poll agota en 5 s, así
  //    que si el precio aparece sólo puede ser por la invalidación, nunca por
  //    un TTL vencido. Si no corre, el poll agota y el test FALLA.
  await expect
    .poll(
      async () => {
        const res = await page.goto(`/productos/${SLUG}`);
        return await res!.text();
      },
      { timeout: 5000, intervals: [200, 300, 500, 500, 1000] },
    )
    .toContain(NUEVO_FORMATEADO);
});
