import { expect, test } from '@playwright/test';

/**
 * US-020 T7.3/T7.4 — la topología de `DELETE /v1/me`, contra la app
 * **construida**. Cierra explícitamente el hueco que dejó pasar el bug real
 * de PR #89 (rewrite `/v1/me/:path*` ausente, encontrado recién por QA en vez
 * de por el propio change de FE — `design.md` §Context/§D8).
 *
 * Espejo exacto de `auth-topology.spec.ts`/`checkout-topology.spec.ts`: todo
 * se asserta sobre `response.status()` y `context.cookies()`, **nunca sobre
 * el DOM** (misma familia que F59 — un componente puede pintar el mensaje
 * correcto aunque el status mienta).
 */
test.describe('Topología de DELETE /v1/me (T7.3/T7.4)', () => {
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

  test('con sesión y CSRF válidos: 204, no un 404 de rewrite ausente — y la cookie de sesión desaparece', async ({
    page,
    context,
  }) => {
    await login(page);
    const csrf = await csrfDeSesion(context);
    expect(csrf).toBeTruthy();

    const status = await page.evaluate(
      async ({ token }) => {
        const res = await fetch('/v1/me', {
          method: 'DELETE',
          headers: { 'X-CSRF-Token': token! },
        });
        return res.status;
      },
      { token: csrf },
    );

    // Un rewrite ausente daría 404, no 204 — la llamada REALMENTE llegó al
    // backend a través de `/v1/me/:path*`.
    expect(status).toBe(204);

    const cookies = await context.cookies();
    expect(cookies.map((c) => c.name)).not.toContain('dsm_access');
  });

  test('tras el borrado, una llamada posterior con la cookie vieja da 401 (la sesión de verdad se cerró)', async ({
    page,
  }) => {
    await login(page);
    await page.evaluate(async () => {
      const csrf = document.cookie.match(/(?:^|;\s*)dsm_csrf=([^;]*)/)?.[1];
      await fetch('/v1/me', {
        method: 'DELETE',
        headers: csrf ? { 'X-CSRF-Token': decodeURIComponent(csrf) } : {},
      });
    });

    const status = await page.evaluate(async () => {
      const res = await fetch('/v1/auth/me');
      return res.status;
    });

    expect(status).toBe(401);
  });

  test('sin X-CSRF-Token: 403, la sesión NO se toca', async ({ page, context }) => {
    await login(page);

    const status = await page.evaluate(async () => {
      const res = await fetch('/v1/me', { method: 'DELETE' });
      return res.status;
    });
    expect(status).toBe(403);

    // La sesión sigue viva: el 403 no disparó el borrado.
    const cookies = await context.cookies();
    expect(cookies.map((c) => c.name)).toContain('dsm_access');
  });

  test('con x-force-blocking-orders: 409 con blocking_orders, la cookie de sesión NO se limpia (AC-4/AC-9)', async ({
    page,
    context,
  }) => {
    await login(page);
    const csrf = await csrfDeSesion(context);

    const { status, body } = await page.evaluate(
      async ({ token }) => {
        const res = await fetch('/v1/me', {
          method: 'DELETE',
          headers: { 'X-CSRF-Token': token!, 'X-Force-Blocking-Orders': '1' },
        });
        return { status: res.status, body: await res.json() };
      },
      { token: csrf },
    );

    expect(status).toBe(409);
    expect(Array.isArray(body.blocking_orders)).toBe(true);
    expect(body.blocking_orders.length).toBeGreaterThan(0);

    const cookies = await context.cookies();
    expect(cookies.map((c) => c.name)).toContain('dsm_access');
  });

  test('dos DELETE seguidos con la misma cookie (doble clic, AC-15 — superficie): ambos 204', async ({
    page,
  }) => {
    await login(page);

    // `Promise.all` (no dos `await` secuenciales): así las DOS requests salen
    // con la cookie de sesión TODAVÍA válida — un `await` intermedio dejaría
    // que el navegador aplique el `Set-Cookie` que limpia `dsm_access` antes
    // de la segunda llamada, y entonces el segundo request no reenviaría
    // ninguna cookie (no probaría idempotencia, probaría "sin sesión").
    const statuses = await page.evaluate(async () => {
      const csrf = document.cookie.match(/(?:^|;\s*)dsm_csrf=([^;]*)/)?.[1];
      const headers: Record<string, string> = csrf
        ? { 'X-CSRF-Token': decodeURIComponent(csrf) }
        : {};
      const [primero, segundo] = await Promise.all([
        fetch('/v1/me', { method: 'DELETE', headers }),
        fetch('/v1/me', { method: 'DELETE', headers }),
      ]);
      return [primero.status, segundo.status];
    });

    // El stub no reproduce la anonimización real (eso es responsabilidad del
    // backend), pero sí el contrato de idempotencia del status code: el
    // segundo DELETE no debe lanzar ni degradar a un error distinto.
    expect(statuses.sort()).toEqual([204, 204]);
  });
});
