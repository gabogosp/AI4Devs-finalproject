import { expect, test } from '@playwright/test';

/**
 * US-008 FE T7.2 — la topología de `/v1/checkout`, contra la app **construida**.
 *
 * Espejo de `cart-topology.spec.ts` (US-007 T5.1) — mismo motivo (ADR-0013):
 * `up.railway.app` está en la Public Suffix List, así que sitio y API son
 * sitios distintos y una llamada que saliera contra el API perdería la cookie
 * `dsm_cart` en el camino. Sin el rewrite de `/v1/checkout/*` (T0.2) el
 * checkout **funciona en local y está roto en producción**.
 *
 * Se asserta sobre `response.status()`, nunca sobre el DOM: un status
 * coherente (201 o 409, según haya carrito) prueba que la llamada LLEGÓ al
 * stub — un 404 significaría rewrite ausente.
 */
test.describe('Topología de /v1/checkout (T7.2)', () => {
  const SLUG = 'compresor-e2e-2';

  async function csrfDelCarrito(context: import('@playwright/test').BrowserContext) {
    const cookies = await context.cookies();
    return cookies.find((c) => c.name === 'dsm_cart_csrf')?.value;
  }

  test('con un carrito válido: 201, no un 404 de rewrite ausente', async ({ page, context }) => {
    await page.goto('/');

    await page.evaluate(async (slug) => {
      await fetch(`/v1/cart/items/${slug}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quantity: 1 }),
      });
    }, SLUG);

    const csrf = await csrfDelCarrito(context);
    expect(csrf).toBeTruthy();

    const status = await page.evaluate(
      async ({ token }) => {
        const res = await fetch('/v1/checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token! },
          body: JSON.stringify({
            buyer: { name: 'Ana Gómez', email: 'ana@example.com', phone: '+54 9 11 5555 5555' },
            consent: true,
            fulfillment: 'pickup',
          }),
        });
        return res.status;
      },
      { token: csrf },
    );

    expect(status).toBe(201);
  });

  test('con el carrito vacío: 409, no un 404', async ({ page, context }) => {
    await page.goto('/');

    // Un carrito EXISTENTE (cookie emitida) pero sin ítems: agrega y quita.
    // El DELETE es una escritura autenticada por cookie: exige el mismo
    // double-submit que el PUT, o el stub lo rechaza con 403 y el ítem queda.
    await page.evaluate(async (slug) => {
      await fetch(`/v1/cart/items/${slug}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quantity: 1 }),
      });
      const csrf = document.cookie.match(/(?:^|;\s*)dsm_cart_csrf=([^;]*)/)?.[1];
      await fetch(`/v1/cart/items/${slug}`, {
        method: 'DELETE',
        headers: csrf ? { 'x-csrf-token': decodeURIComponent(csrf) } : {},
      });
    }, SLUG);

    const csrf = await csrfDelCarrito(context);

    const status = await page.evaluate(
      async ({ token }) => {
        const res = await fetch('/v1/checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token! },
          body: JSON.stringify({
            buyer: { name: 'Ana Gómez', email: 'ana@example.com', phone: '+54 9 11 5555 5555' },
            consent: true,
            fulfillment: 'pickup',
          }),
        });
        return res.status;
      },
      { token: csrf },
    );

    expect(status).toBe(409);
  });
});
