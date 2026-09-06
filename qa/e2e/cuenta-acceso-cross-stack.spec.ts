import { expect, test } from '@playwright/test';
import { datosDeCuenta, PASSWORD_VALIDA } from '../support/customer-auth';

/**
 * `POST /v1/auth/register` tiene su propio `@Throttle` por ruta (5/hora **por IP**,
 * `customer-auth.ts` lo documenta) que NO lee `AUTH_RATE_LIMIT_MAX` — a diferencia de
 * los tests API-context (`nuevoContexto()`), un `page` real de Playwright no manda
 * `x-forwarded-for` por su cuenta, así que TODAS las corridas de este archivo
 * compartirían la misma IP aparente (`localhost`) y se autobloquearían entre sí a la
 * quinta corrida. Cada test fija la suya, mismo mecanismo que `TRUST_PROXY_HOPS=1` ya
 * habilita para el resto de la suite.
 */
let ipContador = 0;
function ipUnica(): string {
  ipContador += 1;
  return `10.77.${Math.floor(Date.now() / 1000) % 256}.${ipContador}`;
}

/**
 * SC-014-X1 (Layer 3, cross-stack) — el único hueco real que quedaba en el
 * sweep de E2E contra la app CONSTRUIDA que pidió el coordinador tras
 * `cuenta-compras-cross-stack.spec.ts` (US-015, PR #89 — encontró el rewrite
 * faltante de `/v1/me/*`).
 *
 * `US-014-registro-login-qa/qa-plan.md` declara la fila **"E2E de navegador
 * contra la API REAL"** como QA-owned — pero lo que se construyó
 * (`qa/e2e/cuenta-cliente.spec.ts`, TC-140/141/142) llama a la API real desde
 * un `APIRequestContext`, sin un solo `page.goto`: prueba el backend real,
 * nunca un navegador de verdad. El único E2E que SÍ abre un navegador
 * (`apps/web/e2e/auth-journey.spec.ts`) corre contra `api-stub.mjs` (Layer 2,
 * dev-owned) — bcrypt ahí es una comparación de strings y la sesión vive en
 * un `Map`. Ninguno de los dos cubre "navegador real + API real + app
 * CONSTRUIDA" para el login/registro, que es exactamente la combinación que
 * `cuenta-compras-cross-stack.spec.ts` demostró que puede esconder un defecto
 * de topología invisible en cualquier otra capa (el rewrite same-origin de
 * ADR-0013). `/v1/auth/*` ya tiene su entrada — este spec es la prueba viva
 * de que la cookie de sesión realmente viaja ida y vuelta contra el build
 * real, no sólo una verificación de que el código la declara.
 *
 * No duplica `cuenta-cliente.spec.ts` (rate-limit, enumeración, rotación de
 * refresh — ver ese spec) ni `auth-journey.spec.ts` (esos mismos casos,
 * contra el stub). Selectores por rol/label, mismo patrón que ambos.
 */
test.describe('SC-014-X1 — acceso de cuenta cross-stack (navegador real + API real)', () => {
  test('AC-1/AC-9: registro deja sesión activa con cookies httpOnly, sin pasar por /ingresar', async ({
    page,
    context,
  }) => {
    const cuenta = datosDeCuenta('-e2e-acceso');
    await context.setExtraHTTPHeaders({ 'x-forwarded-for': ipUnica() });

    await page.goto('/crear-cuenta');
    await page.getByLabel(/nombre/i).fill(cuenta.nombre);
    await page.getByLabel(/email/i).fill(cuenta.email);
    await page.getByLabel(/contraseña/i).fill(cuenta.password);

    const [res] = await Promise.all([
      page.waitForResponse('**/v1/auth/register'),
      page.getByRole('button', { name: /crear cuenta/i }).click(),
    ]);
    expect(res.status()).toBe(201);

    await expect(page).toHaveURL(/\/mi-cuenta$/);
    await expect(page.getByText(cuenta.email)).toBeVisible();

    const cookies = await context.cookies();
    const access = cookies.find((c) => c.name === 'dsm_access');
    const refresh = cookies.find((c) => c.name === 'dsm_refresh');
    expect(access?.httpOnly).toBe(true);
    expect(refresh?.httpOnly).toBe(true);
  });

  test('AC-2/AC-3: logout invalida la sesión real y volver a entrar con las mismas credenciales funciona', async ({
    page,
    context,
  }) => {
    const cuenta = datosDeCuenta('-e2e-acceso-ciclo');
    await context.setExtraHTTPHeaders({ 'x-forwarded-for': ipUnica() });

    // Registro por UI para dejar la cuenta creada contra el backend real.
    await page.goto('/crear-cuenta');
    await page.getByLabel(/nombre/i).fill(cuenta.nombre);
    await page.getByLabel(/email/i).fill(cuenta.email);
    await page.getByLabel(/contraseña/i).fill(cuenta.password);
    await Promise.all([
      page.waitForResponse('**/v1/auth/register'),
      page.getByRole('button', { name: /crear cuenta/i }).click(),
    ]);
    await expect(page).toHaveURL(/\/mi-cuenta$/);

    // AC-3: logout real invalida — /mi-cuenta deja de ser alcanzable.
    const [logoutRes] = await Promise.all([
      page.waitForResponse('**/v1/auth/logout'),
      page.getByRole('button', { name: /cerrar sesión/i }).first().click(),
    ]);
    expect(logoutRes.status()).toBe(204);
    await page.goto('/mi-cuenta');
    await expect(page).toHaveURL(/\/ingresar/);

    // AC-2: login real, dos vueltas, contra la cuenta ya registrada arriba.
    for (const vuelta of [1, 2]) {
      await page.goto('/ingresar');
      await page.getByLabel(/email/i).fill(cuenta.email);
      await page.getByLabel(/contraseña/i).fill(PASSWORD_VALIDA);
      const [loginRes] = await Promise.all([
        page.waitForResponse('**/v1/auth/login'),
        page.getByRole('button', { name: /^ingresar$/i }).click(),
      ]);
      expect(loginRes.status(), `vuelta ${vuelta}`).toBe(200);
      await expect(page, `vuelta ${vuelta}`).toHaveURL(/\/mi-cuenta$/);

      await page.getByRole('button', { name: /cerrar sesión/i }).first().click();
      await expect(page.getByRole('link', { name: /ingresar/i }).first()).toBeVisible();
    }
  });
});
