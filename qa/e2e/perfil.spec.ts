import { expect, test } from '@playwright/test';
import { datosDeCuenta } from '../support/customer-auth';
import { sembrarProductoPublicado } from '../support/seed-order-history';

/**
 * QA-024-E2E-1 (US-024, `qa-plan.md` §5) — cierra el `Blocked-by: FE-US-024`
 * de `tasks.md` ahora que el FE aterrizó (PR #133). Mismo patrón que
 * `cuenta-compras-cross-stack.spec.ts` (US-015): navegador real, contra la
 * app construida y el backend real, sin inyectar cookies ni stubbear nada —
 * el registro y la edición de perfil pasan por el mismo `page`, así que la
 * sesión que deja el registro es la que `PATCH /v1/me` usa.
 */

/**
 * `POST /auth/register` tiene su propio presupuesto endurecido
 * (`@Throttle({ auth: { limit: 5, ttl: 3_600_000 } })` en
 * `customer-auth.controller.ts`, literal — no lee de env, así que
 * `AUTH_RATE_LIMIT_MAX` de `qa/scripts/api-up.sh` no lo levanta). Un
 * navegador real no puede spoofear su propia IP como sí hace
 * `customer-auth.ts` con `APIRequestContext`, pero SÍ puede fijar el header
 * `X-Forwarded-For` por página (`TRUST_PROXY_HOPS=1` en `api-up.sh` hace que
 * el backend confíe en él) — mismo criterio, aplicado al navegador.
 */
let ip = 0;
const SEED = Date.now() & 255;
const proximaIp = (): string => {
  ip += 1;
  return `10.24.${SEED}.${ip & 255}`;
};

test.describe('Edición de perfil del cliente (US-024, cross-stack)', () => {
  test.beforeEach(async ({ page }) => {
    await page.setExtraHTTPHeaders({ 'x-forwarded-for': proximaIp() });
  });

  test('SC-024-H1 — editar el nombre: se refleja en el form y en el buyer_name del próximo checkout (AC-1)', async ({
    page,
  }) => {
    const cuenta = datosDeCuenta('-e2e-perfil-nombre');
    const nombreNuevo = 'Ana María Pérez QA';
    const slug = await sembrarProductoPublicado();

    await page.goto('/crear-cuenta');
    await page.getByLabel(/nombre/i).fill(cuenta.nombre);
    await page.getByLabel(/email/i).fill(cuenta.email);
    await page.getByLabel(/contraseña/i).fill(cuenta.password);
    const [registerRes] = await Promise.all([
      page.waitForResponse('**/v1/auth/register'),
      page.getByRole('button', { name: /crear cuenta/i }).click(),
    ]);
    expect(registerRes.status(), await registerRes.text()).toBe(201);
    await expect(page).toHaveURL(/\/mi-cuenta$/);

    // `getByLabel(/nombre/i)` sin anclar con `^$`: el `<label>` de este campo
    // incluye un `<span aria-hidden="true"> *</span>` para el asterisco de
    // requerido, y el nombre accesible que computa Chromium para el label
    // termina con espacio final ("Nombre ") pese al `aria-hidden` — un
    // `^nombre$` estricto no matchea nunca. Sin ambigüedad real con "Avatar
    // (URL)", que no contiene "nombre" como substring.
    const form = page.getByRole('form', { name: /editar perfil/i });
    await expect(form.getByLabel(/nombre/i)).toHaveValue(cuenta.nombre);
    await form.getByLabel(/nombre/i).fill(nombreNuevo);

    const [patchRes] = await Promise.all([
      page.waitForResponse('**/v1/me'),
      form.getByRole('button', { name: /^guardar$/i }).click(),
    ]);
    expect(patchRes.status(), await patchRes.text()).toBe(200);
    await expect(page.getByRole('status')).toHaveText(/perfil actualizado/i);
    // Sin recargar: el mismo input sigue mostrando el valor nuevo.
    await expect(form.getByLabel(/nombre/i)).toHaveValue(nombreNuevo);

    // El nombre editado llega al próximo checkout como buyer_name pre-llenado
    // (AC-1, segunda cláusula) — CheckoutForm lee `useSession().customer.name`.
    await page.goto(`/productos/${slug}`);
    await Promise.all([
      page.waitForResponse('**/v1/cart/items/**'),
      page.getByRole('button', { name: /agregar al carrito/i }).click(),
    ]);
    await page.goto('/carrito');
    await page.getByRole('button', { name: /ir al pago/i }).click();
    await expect(page).toHaveURL(/\/checkout$/);
    await expect(page.getByLabel(/nombre/i)).toHaveValue(nombreNuevo);
  });

  test('SC-024-H2/H3 — pegar un avatar reemplaza el placeholder, borrarlo lo restaura (AC-2, AC-3)', async ({
    page,
  }) => {
    const cuenta = datosDeCuenta('-e2e-perfil-avatar');
    const avatarUrl = 'https://picsum.photos/200';

    await page.goto('/crear-cuenta');
    await page.getByLabel(/nombre/i).fill(cuenta.nombre);
    await page.getByLabel(/email/i).fill(cuenta.email);
    await page.getByLabel(/contraseña/i).fill(cuenta.password);
    await Promise.all([
      page.waitForResponse('**/v1/auth/register'),
      page.getByRole('button', { name: /crear cuenta/i }).click(),
    ]);
    await expect(page).toHaveURL(/\/mi-cuenta$/);

    // AC-2: sin avatar todavía, el placeholder de iniciales es el estado normal.
    const avatarPlaceholder = page.getByRole('img', { name: new RegExp(`avatar de ${cuenta.nombre}`, 'i') });
    await expect(avatarPlaceholder).toBeVisible();

    const form = page.getByRole('form', { name: /editar perfil/i });
    await form.getByLabel(/avatar/i).fill(avatarUrl);
    const [patchRes] = await Promise.all([
      page.waitForResponse('**/v1/me'),
      form.getByRole('button', { name: /^guardar$/i }).click(),
    ]);
    expect(patchRes.status(), await patchRes.text()).toBe(200);

    // El placeholder (role=img de iniciales) se reemplaza por la imagen real.
    await expect(page.getByRole('img', { name: new RegExp(`avatar de ${cuenta.nombre}`, 'i') })).toHaveAttribute(
      'src',
      avatarUrl,
    );

    // AC-3: borrar la URL y guardar vuelve al placeholder.
    await form.getByLabel(/avatar/i).fill('');
    const [patchRes2] = await Promise.all([
      page.waitForResponse('**/v1/me'),
      form.getByRole('button', { name: /^guardar$/i }).click(),
    ]);
    expect(patchRes2.status(), await patchRes2.text()).toBe(200);
    await expect(
      page.getByRole('img', { name: new RegExp(`avatar de ${cuenta.nombre}`, 'i') }),
    ).not.toHaveAttribute('src', avatarUrl);
  });

  test('SC-024-N2 — URL de avatar inválida se rechaza, el avatar anterior no cambia (AC-5)', async ({ page }) => {
    const cuenta = datosDeCuenta('-e2e-perfil-avatar-invalido');

    await page.goto('/crear-cuenta');
    await page.getByLabel(/nombre/i).fill(cuenta.nombre);
    await page.getByLabel(/email/i).fill(cuenta.email);
    await page.getByLabel(/contraseña/i).fill(cuenta.password);
    await Promise.all([
      page.waitForResponse('**/v1/auth/register'),
      page.getByRole('button', { name: /crear cuenta/i }).click(),
    ]);
    await expect(page).toHaveURL(/\/mi-cuenta$/);

    const form = page.getByRole('form', { name: /editar perfil/i });
    await form.getByLabel(/avatar/i).fill('no-es-una-url');
    await form.getByRole('button', { name: /^guardar$/i }).click();

    await expect(form.getByText(/url inválida|debe empezar con http/i)).toBeVisible();
    // Rechazo del lado del cliente (Zod): no llega a pegarle a la API.
    await expect(page.getByRole('img', { name: new RegExp(`avatar de ${cuenta.nombre}`, 'i') })).toBeVisible();
  });
});
