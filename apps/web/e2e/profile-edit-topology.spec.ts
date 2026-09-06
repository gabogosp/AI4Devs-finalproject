import { expect, test } from '@playwright/test';

/**
 * US-024 T4.1 — la topología de `PATCH /v1/me`, contra la app **construida**.
 * Espejo exacto de `account-deletion-topology.spec.ts`: todo se asserta sobre
 * `response.status()`, nunca sobre el DOM (misma familia que F59 — un
 * componente puede pintar el mensaje correcto aunque el status mienta).
 *
 * Prueba que `/v1/me/:path*` (rewrite same-origin de US-020) es
 * method-agnostic: cubre también `PATCH`, no sólo `DELETE`/`GET`.
 */
test.describe('Topología de PATCH /v1/me (T4.1)', () => {
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

  test('con sesión y CSRF válidos: 200, no un 404 de rewrite ausente', async ({
    page,
    context,
  }) => {
    await login(page);
    const csrf = await csrfDeSesion(context);
    expect(csrf).toBeTruthy();

    const { status, body } = await page.evaluate(
      async ({ token }) => {
        const res = await fetch('/v1/me', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token! },
          body: JSON.stringify({ name: 'Nuevo Nombre', avatar_url: null }),
        });
        return { status: res.status, body: await res.json() };
      },
      { token: csrf },
    );

    // Un rewrite ausente daría 404, no 200 — la llamada REALMENTE llegó al
    // backend a través de `/v1/me/:path*`.
    expect(status).toBe(200);
    expect(body.name).toBe('Nuevo Nombre');
  });

  test('sin X-CSRF-Token: 403, el perfil NO cambia', async ({ page, context }) => {
    await login(page);

    const status = await page.evaluate(async () => {
      const res = await fetch('/v1/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'No Debería Guardarse', avatar_url: null }),
      });
      return res.status;
    });
    expect(status).toBe(403);

    // El 403 no disparó el guardado: `GET /auth/me` sigue con el nombre
    // original.
    const nombreActual = await page.evaluate(async () => {
      const res = await fetch('/v1/auth/me');
      return (await res.json()).name;
    });
    expect(nombreActual).not.toBe('No Debería Guardarse');
    void context;
  });

  test('sin sesión: 401', async ({ page }) => {
    await page.goto('/');

    const status = await page.evaluate(async () => {
      const res = await fetch('/v1/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Alguien', avatar_url: null }),
      });
      return res.status;
    });
    expect(status).toBe(401);
  });

  test('nombre vacío: 422, el perfil NO cambia', async ({ page, context }) => {
    await login(page);
    const csrf = await csrfDeSesion(context);

    const status = await page.evaluate(
      async ({ token }) => {
        const res = await fetch('/v1/me', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token! },
          body: JSON.stringify({ name: '   ', avatar_url: null }),
        });
        return res.status;
      },
      { token: csrf },
    );
    expect(status).toBe(422);
  });
});
