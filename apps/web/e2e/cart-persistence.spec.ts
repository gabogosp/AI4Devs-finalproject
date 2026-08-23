import { expect, test } from '@playwright/test';

/**
 * US-007 T5.2 — persistencia entre visitas (AC-4).
 *
 * Lo que se prueba es que el carrito sobreviva **cerrando el navegador**, y que el
 * frontend **no administre** la cookie: `dsm_cart` es `httpOnly`, así que la
 * persistencia la aporta el backend y el FE no puede ni leerla. Por eso se asserta
 * sobre `storageState` y sobre `document.cookie`, no sobre el DOM.
 */
test.describe('Persistencia del carrito entre visitas (T5.2)', () => {
  const SLUG = 'compresor-e2e-2';

  test('el carrito sigue ahí en un contexto nuevo con el mismo storageState', async ({
    browser,
  }) => {
    // --- Primera visita: se agrega algo ---
    const primera = await browser.newContext();
    const p1 = await primera.newPage();
    await p1.goto('/');

    const escritura = await p1.evaluate(async (slug) => {
      const res = await fetch(`/v1/cart/items/${slug}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quantity: 3 }),
        cache: 'no-store',
      });
      return { status: res.status, body: await res.text() };
    }, SLUG);
    expect(escritura.status, escritura.body).toBe(200);

    // El FE **no** administra la cookie del carrito: no la ve ni la escribe.
    const visibles = await p1.evaluate(() => document.cookie);
    expect(visibles).not.toContain('dsm_cart=');
    expect(visibles).toContain('dsm_cart_csrf');

    // Se guarda el estado como lo haría el navegador al cerrarse y se cierra.
    const estado = await primera.storageState();
    await primera.close();

    // --- Segunda visita: contexto nuevo, mismo estado de almacenamiento ---
    const segunda = await browser.newContext({ storageState: estado });
    const p2 = await segunda.newPage();
    await p2.goto('/');

    const lectura = await p2.evaluate(async () => {
      const res = await fetch('/v1/cart', { cache: 'no-store' });
      return res.json();
    });

    // Sin haber creado cuenta: la identidad del carrito es la cookie, no un login.
    expect(lectura.cart.items).toHaveLength(1);
    expect(lectura.cart.items[0].slug).toBe(SLUG);
    expect(lectura.cart.items[0].quantity).toBe(3);
    await segunda.close();
  });

  test('un contexto SIN ese estado arranca vacío (la persistencia es de la cookie, no del servidor)', async ({
    browser,
  }) => {
    // Si esto trajera el carrito de la otra visita, la identidad estaría mal
    // resuelta —compartida entre visitantes— y sería un problema de privacidad,
    // no una comodidad.
    const limpio = await browser.newContext();
    const pagina = await limpio.newPage();
    await pagina.goto('/');

    const lectura = await pagina.evaluate(async () => {
      const res = await fetch('/v1/cart', { cache: 'no-store' });
      return res.json();
    });

    expect(lectura.cart.items).toHaveLength(0);
    expect(lectura.cart.id).toBeNull();
    await limpio.close();
  });

  test('la cantidad se conserva tal como la fijó la última escritura', async ({
    browser,
  }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto('/');

    const cantidades = await page.evaluate(async (slug) => {
      // El double-submit se arma leyendo la cookie legible, igual que hace
      // `customFetch`: una vez que el carrito existe, el backend EXIGE el header y
      // sin él la segunda escritura es un 403 (verificado — el stub lo rechaza).
      const put = async (quantity: number) => {
        const csrf = document.cookie.match(/(?:^|;\s*)dsm_cart_csrf=([^;]*)/)?.[1];
        const res = await fetch(`/v1/cart/items/${slug}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            ...(csrf ? { 'x-csrf-token': decodeURIComponent(csrf) } : {}),
          },
          body: JSON.stringify({ quantity }),
          cache: 'no-store',
        });
        return res.status;
      };
      const primero = await put(2);
      const segundo = await put(5);
      const res = await fetch('/v1/cart', { cache: 'no-store' });
      const json = await res.json();
      return { cantidad: json.cart.items[0]?.quantity, primero, segundo };
    }, SLUG);

    // Las dos escrituras tienen que haber sido aceptadas, o el assert de abajo
    // pasaría por el motivo equivocado.
    expect([cantidades.primero, cantidades.segundo]).toEqual([200, 200]);
    // El PUT fija la cantidad ABSOLUTA: dos escrituras no suman 7.
    expect(cantidades.cantidad).toBe(5);
    await ctx.close();
  });
});
