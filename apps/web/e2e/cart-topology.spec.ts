import { expect, test } from '@playwright/test';

/**
 * US-007 T5.1 — la topología del carrito, contra la app **construida**.
 *
 * Espejo de `auth-topology.spec.ts`, que es el precedente que dejó ADR-0013. El
 * carrito hereda el problema: `up.railway.app` está en la Public Suffix List, así
 * que el sitio y el API son sitios distintos y una cookie emitida por el API no
 * vuelve nunca. Sin el rewrite de `/v1/cart/*` el carrito **funciona en local y
 * está roto en producción**, y ningún unit test puede detectarlo.
 *
 * Todo se asserta sobre `response.status()` y `context.cookies()`, **nunca sobre
 * el DOM**: un assert de DOM no distingue un carrito real de una pantalla que dice
 * que agregó algo.
 */
test.describe('Topología de cookies del carrito (T5.1)', () => {
  const SLUG = 'compresor-e2e-1';

  test('la escritura por el origen del sitio deja las cookies en el dominio del sitio', async ({
    page,
    context,
    baseURL,
  }) => {
    await page.goto('/');

    // El PUT sale del navegador contra el ORIGEN DEL SITIO, no contra el API.
    const status = await page.evaluate(async (slug) => {
      const res = await fetch(`/v1/cart/items/${slug}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quantity: 2 }),
      });
      return res.status;
    }, SLUG);
    expect(status).toBe(200);

    const cookies = await context.cookies();
    const nombres = cookies.map((c) => c.name);
    expect(nombres).toContain('dsm_cart');
    expect(nombres).toContain('dsm_cart_csrf');

    // El acceso al carrito no es legible por JS; el token de CSRF sí, a propósito.
    const acceso = cookies.find((c) => c.name === 'dsm_cart')!;
    const csrf = cookies.find((c) => c.name === 'dsm_cart_csrf')!;
    expect(acceso.httpOnly).toBe(true);
    expect(csrf.httpOnly).toBe(false);

    // La cookie vive en el dominio DEL SITIO. En el del API, el navegador no la
    // devolvería y el carrito sería inservible.
    const host = new URL(baseURL!).hostname;
    expect(acceso.domain.replace(/^\./, '')).toBe(host);
  });

  test('la cookie VUELVE: el GET posterior trae el ítem', async ({ page }) => {
    await page.goto('/');
    const escritura = await page.evaluate(async (slug) => {
      const res = await fetch(`/v1/cart/items/${slug}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quantity: 2 }),
      });
      return { status: res.status, body: await res.text() };
    }, SLUG);
    // Sin este assert, un 403 acá se vería como «el GET no trae el ítem» y mandaría
    // a buscar el problema al lado equivocado.
    expect(escritura.status, escritura.body).toBe(200);

    // Éste es el test que prueba la topología: emitir la cookie no sirve de nada
    // si el navegador no la reenvía en la siguiente request.
    const cuerpo = await page.evaluate(async () => {
      // `no-store` porque es lo que hace la app: `customFetch` lo fija para las
      // superficies con cookies. Sin él, este segundo GET a la MISMA URL se sirve
      // de la caché del navegador y el test mediría la caché en vez de la
      // topología — que es exactamente el defecto que este spec destapó.
      const res = await fetch('/v1/cart', { cache: 'no-store' });
      return { status: res.status, json: await res.json() };
    });

    expect(cuerpo.status, escritura.body).toBe(200);
    expect(cuerpo.json.cart.items).toHaveLength(1);
    expect(cuerpo.json.cart.items[0].slug).toBe(SLUG);
    expect(cuerpo.json.cart.total_quantity).toBe(2);
  });

  test('un contexto NUEVO ve el carrito vacío (el 200 anterior no era falso positivo)', async ({
    browser,
  }) => {
    const contexto = await browser.newContext();
    const pagina = await contexto.newPage();
    await pagina.goto('/');

    const cuerpo = await pagina.evaluate(async () => {
      // `no-store` porque es lo que hace la app: `customFetch` lo fija para las
      // superficies con cookies. Sin él, este segundo GET a la MISMA URL se sirve
      // de la caché del navegador y el test mediría la caché en vez de la
      // topología — que es exactamente el defecto que este spec destapó.
      const res = await fetch('/v1/cart', { cache: 'no-store' });
      return { status: res.status, json: await res.json() };
    });

    expect(cuerpo.status).toBe(200);
    expect(cuerpo.json.cart.items).toHaveLength(0);
    expect(cuerpo.json.cart.id).toBeNull();
    await contexto.close();
  });

  test('el token del carrito no es alcanzable desde JavaScript', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(async (slug) => {
      await fetch(`/v1/cart/items/${slug}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quantity: 1 }),
      });
    }, SLUG);

    const visibles = await page.evaluate(() => document.cookie);
    expect(visibles).not.toContain('dsm_cart=');
    // La de CSRF sí tiene que verse: el frontend la lee para reenviarla.
    expect(visibles).toContain('dsm_cart_csrf');
  });
});
