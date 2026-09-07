import { expect, test } from '@playwright/test';

/**
 * US-025 T-B6/T-B7 — la topología de `GET`/`PUT /v1/me/reviews/{productId}`,
 * contra la app **construida**. Cierra el mismo hueco que `design.md` §D6
 * documenta explícitamente: el rewrite `/v1/me/:path*` ya existe y ya cubre
 * el prefijo nuevo por construcción (Next.js resuelve `:path*` como un
 * segmento multi-parte), pero "el patrón cubre el path" no es lo mismo que
 * "alguien lo probó contra la app construida" — el mismo motivo por el que
 * el bug real de rewrite ausente de PR #89 (US-020 §Context) llegó a
 * producción invisible para todo excepto QA.
 *
 * Espejo exacto de `account-deletion-topology.spec.ts`: todo se asserta
 * sobre `response.status()`, **nunca sobre el DOM** (F59).
 */
test.describe('Topología de GET/PUT /v1/me/reviews/:productId (T-B7)', () => {
  const PRODUCT_ID = '77777777-7777-4777-8777-777777777777';

  async function login(page: import('@playwright/test').Page) {
    await page.goto('/');
    const status = await page.evaluate(async () => {
      const res = await fetch('/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'ana@example.com',
          password: 'Contrasena-Valida-1',
        }),
      });
      return res.status;
    });
    expect(status).toBe(200);
  }

  async function csrfDeSesion(context: import('@playwright/test').BrowserContext) {
    const cookies = await context.cookies();
    return cookies.find((c) => c.name === 'dsm_csrf')?.value;
  }

  test('con sesión y CSRF válidos: PUT responde 200/201, no un 404 de rewrite ausente (AC-1/AC-2/AC-5)', async ({
    page,
    context,
  }) => {
    await login(page);
    const csrf = await csrfDeSesion(context);
    expect(csrf).toBeTruthy();

    const status = await page.evaluate(
      async ({ productId, token }) => {
        const res = await fetch(`/v1/me/reviews/${productId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token! },
          body: JSON.stringify({ rating: 4, comment: 'Anduvo bien' }),
        });
        return res.status;
      },
      { productId: PRODUCT_ID, token: csrf },
    );

    // Un rewrite ausente daría 404, no 200/201 — la llamada REALMENTE llegó
    // al backend a través de `/v1/me/:path*`.
    expect([200, 201]).toContain(status);
  });

  test('sin sesión: GET y PUT responden 401 (AC-7)', async ({ page }) => {
    await page.goto('/');

    const statuses = await page.evaluate(async (productId) => {
      const get = await fetch(`/v1/me/reviews/${productId}`);
      const put = await fetch(`/v1/me/reviews/${productId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating: 4 }),
      });
      return { get: get.status, put: put.status };
    }, PRODUCT_ID);

    expect(statuses.get).toBe(401);
    expect(statuses.put).toBe(401);
  });

  test('sin X-CSRF-Token: 403, la sesión sigue viva', async ({ page, context }) => {
    await login(page);

    const status = await page.evaluate(async (productId) => {
      const res = await fetch(`/v1/me/reviews/${productId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating: 4 }),
      });
      return res.status;
    }, PRODUCT_ID);
    expect(status).toBe(403);

    const cookies = await context.cookies();
    expect(cookies.map((c) => c.name)).toContain('dsm_access');
  });

  test('con X-Force-Not-Eligible: 403 dsm:reviews/not-eligible (AC-6 — nunca compró el producto)', async ({
    page,
    context,
  }) => {
    await login(page);
    const csrf = await csrfDeSesion(context);

    const { status, body } = await page.evaluate(
      async ({ productId, token }) => {
        const res = await fetch(`/v1/me/reviews/${productId}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': token!,
            'X-Force-Not-Eligible': '1',
          },
          body: JSON.stringify({ rating: 4 }),
        });
        return { status: res.status, body: await res.json() };
      },
      { productId: PRODUCT_ID, token: csrf },
    );

    expect(status).toBe(403);
    expect(body.type).toBe('dsm:reviews/not-eligible');
  });

  test('con X-Force-Invalid-Rating: 422 (AC-9 — rating fuera de 1-5, autoridad del servidor)', async ({
    page,
    context,
  }) => {
    await login(page);
    const csrf = await csrfDeSesion(context);

    const status = await page.evaluate(
      async ({ productId, token }) => {
        const res = await fetch(`/v1/me/reviews/${productId}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': token!,
            'X-Force-Invalid-Rating': '1',
          },
          body: JSON.stringify({ rating: 4 }),
        });
        return res.status;
      },
      { productId: PRODUCT_ID, token: csrf },
    );

    expect(status).toBe(422);
  });
});
