import { expect, test } from '@playwright/test';

/**
 * US-014 T0.3 — la premisa del plan, probada antes de construir UI encima.
 *
 * OQ-FE-1 eligió el rewrite same-origin porque las cookies que emite el API son
 * host-only y `up.railway.app` está en la Public Suffix List: el navegador trata
 * al API y al sitio como sitios distintos, así que una cookie emitida por el API
 * **no vuelve nunca**. Si el rewrite no propagara `Set-Cookie`, `context.cookies()`
 * viene vacío y estos tests fallan — que es exactamente el descubrimiento que
 * queremos temprano y no después de cinco pantallas.
 *
 * Todo se asserta sobre `response.status()` y `context.cookies()`, **nunca sobre
 * el DOM**: un assert de DOM no distingue una sesión real de una pantalla que
 * dice "hola" (misma familia que F59, el 404 degradado a soft-200).
 */
test.describe('Topología de cookies de sesión (T0.3)', () => {
  test.beforeEach(async ({ request }) => {
    await request.post('http://localhost:4010/__reset?scope=auth');
  });

  test('el login por el origen del sitio deja las cookies en el dominio del sitio', async ({
    page,
    context,
    baseURL,
  }) => {
    await page.goto('/');

    // El POST sale del navegador contra el ORIGEN DEL SITIO, no contra el API.
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

    const cookies = await context.cookies();
    const nombres = cookies.map((c) => c.name);
    expect(nombres).toContain('dsm_access');
    expect(nombres).toContain('dsm_csrf');

    // AC-9: el token de sesión no es legible por JS; el de CSRF sí, a propósito.
    const access = cookies.find((c) => c.name === 'dsm_access')!;
    const csrf = cookies.find((c) => c.name === 'dsm_csrf')!;
    expect(access.httpOnly).toBe(true);
    expect(csrf.httpOnly).toBe(false);

    // La cookie vive en el dominio DEL SITIO. Si estuviera en el del API, el
    // navegador no la devolvería y toda la sesión sería inservible.
    const host = new URL(baseURL!).hostname;
    expect(access.domain.replace(/^\./, '')).toBe(host);
  });

  test('la cookie VUELVE: una llamada posterior autenticada devuelve 200', async ({
    page,
  }) => {
    await page.goto('/');
    await page.evaluate(async () => {
      await fetch('/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'ana@example.com',
          password: 'Contrasena-Valida-1',
        }),
      });
    });

    // Éste es el test que realmente prueba la topología: emitir la cookie no
    // sirve de nada si el navegador no la reenvía en la siguiente request.
    const status = await page.evaluate(async () => {
      const res = await fetch('/v1/auth/me');
      return res.status;
    });
    expect(status).toBe(200);
  });

  test('sin sesión, la llamada autenticada da 401 (el 200 anterior no era un falso positivo)', async ({
    page,
  }) => {
    await page.goto('/');

    const status = await page.evaluate(async () => {
      const res = await fetch('/v1/auth/me');
      return res.status;
    });
    expect(status).toBe(401);
  });

  test('el token de sesión no es alcanzable desde JavaScript (AC-9)', async ({
    page,
  }) => {
    await page.goto('/');
    await page.evaluate(async () => {
      await fetch('/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'ana@example.com',
          password: 'Contrasena-Valida-1',
        }),
      });
    });

    const visibles = await page.evaluate(() => document.cookie);
    expect(visibles).not.toContain('dsm_access');
    expect(visibles).not.toContain('dsm_refresh');
    // La de CSRF sí tiene que verse: el frontend la lee para reenviarla.
    expect(visibles).toContain('dsm_csrf');
  });
});
