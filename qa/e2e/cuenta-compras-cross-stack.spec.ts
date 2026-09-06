import { expect, test } from '@playwright/test';
import { datosDeCuenta } from '../support/customer-auth';
import { sembrarProductoPublicado } from '../support/seed-order-history';
import { QA_API_BASE_URL } from '../support/qa-env';

/**
 * SC-015-X1 (Layer 3, cross-stack) — el escenario que
 * `US-015-historial-compras-qa/design.md` §D-QA2 declaró explícitamente
 * `Deferred` porque, al planificar, `US-015-historial-compras-frontend-web`
 * seguía en curso en otro worktree y no había ninguna página
 * `/mi-cuenta/compras` que un Playwright pudiera visitar — escribirlo
 * entonces hubiera sido el mismo anti-patrón que `US-010-*-qa` ya evitó para
 * `SC-010-N2` (simular en vez de declarar bloqueado). El FE aterrizó después
 * (PR #74, US-015 ya archivada por completo, `Done`) — este spec cierra ese
 * diferido, ahora que la UI existe de verdad.
 *
 * **Home del artefacto** (decisión, per lo que pidió el coordinador): vive
 * directo en `qa/e2e/`, mismo harness Playwright que ya usan
 * `pago-webhook-cross-stack.spec.ts` (US-010) y `cuenta-*.spec.ts` (US-014) —
 * no un change/worktree nuevo. No hay una disciplina QA "abierta" a la que
 * agregarle una task (la de US-015 ya está archivada, y reabrir un change
 * archivado no es el patrón de este repo); el patrón real es el mismo que ya
 * usan los otros Layer 3 diferidos-y-luego-resueltos de este proyecto: un
 * commit que agrega el spec al harness existente + una nota en la capacidad
 * (`openspec/specs/historial-compras/README.md` §Qué verificó QA). Cero
 * duplicación de infraestructura: reusa `playwright.config.ts`,
 * `datosDeCuenta()` (US-014) y `sembrarProductoPublicado()` (US-015 QA,
 * `seed-order-history.ts`) tal cual.
 *
 * Todo por el navegador real, contra la app construida — sin inyectar
 * cookies ni tocar `APIRequestContext`: el registro, el agregar-al-carrito y
 * el checkout pasan por el mismo `page` (mismo criterio de
 * `pago-webhook-cross-stack.spec.ts`), así que la cookie de sesión que deja
 * el registro es la MISMA que `OptionalCustomerGuard` lee al crear la orden
 * — es, literalmente, lo que hace que `customer_id` quede seteado (US-015,
 * alcance ampliado del backend). `POST /checkout/simulate-payment` es la
 * única llamada fuera del navegador: no necesita la cookie de sesión (sólo
 * `order_token` en el body, verificado en `checkout.controller.ts`) y no hay
 * botón en la UI que lo dispare (medio de test/demo, US-010) — mismo criterio
 * que ya documentó `seed-order-history.ts`.
 */
test('SC-015-X1 — el cliente compra logueado y ve la compra en su historial (AC-1, AC-2)', async ({
  page,
}) => {
  const slug = await sembrarProductoPublicado();
  const cuenta = datosDeCuenta('-e2e-historial');

  // 1) Registro REAL por la UI — deja sesión activa sin pasar por /ingresar
  //    (US-014 AC-1). Esta es la cookie que OptionalCustomerGuard va a leer.
  await page.goto('/crear-cuenta');
  await page.getByLabel(/nombre/i).fill(cuenta.nombre);
  await page.getByLabel(/email/i).fill(cuenta.email);
  await page.getByLabel(/contraseña/i).fill(cuenta.password);
  await Promise.all([
    page.waitForResponse('**/v1/auth/register'),
    page.getByRole('button', { name: /crear cuenta/i }).click(),
  ]);
  await expect(page).toHaveURL(/\/mi-cuenta$/);

  // 2) Checkout REAL por la UI, con la sesión de cliente activa —
  //    mismos selectores por rol/label que `checkout-happy-path.spec.ts`.
  await page.goto(`/productos/${slug}`);
  const [agregar] = await Promise.all([
    page.waitForResponse('**/v1/cart/items/**'),
    page.getByRole('button', { name: /agregar al carrito/i }).click(),
  ]);
  expect(agregar.status(), await agregar.text()).toBe(200);

  await page.goto('/carrito');
  await expect(page.getByRole('button', { name: /ir al pago/i })).toBeEnabled();
  await page.getByRole('button', { name: /ir al pago/i }).click();
  await expect(page).toHaveURL(/\/checkout$/);

  await page.getByLabel(/nombre/i).fill(cuenta.nombre);
  await page.getByLabel(/email/i).fill(cuenta.email);
  await page.getByLabel(/teléfono/i).fill('+54 9 11 5555 5555');
  await page.getByRole('checkbox').check();

  const [checkoutRes] = await Promise.all([
    page.waitForResponse('**/v1/checkout'),
    page.getByRole('button', { name: /confirmar pedido/i }).click(),
  ]);
  expect(checkoutRes.status(), await checkoutRes.text()).toBe(201);
  const { order_token: orderToken, order_number: orderNumber } =
    (await checkoutRes.json()) as { order_token: string; order_number: number };
  await expect(page.getByRole('heading', { name: /pedido quedó registrado/i })).toBeVisible();

  // 3) Confirmar el pago (medio simulado "DSM", US-010) — sin cookie, sin UI
  //    propia; deja la orden en `new` con `customer_id` ya seteado.
  const confirm = await fetch(`${QA_API_BASE_URL}/v1/checkout/simulate-payment`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ order_token: orderToken }),
  });
  expect(confirm.status, await confirm.text()).toBe(200);

  // 4) El historial, en el MISMO navegador logueado — la prueba de punta a
  //    punta de que `customer_id` quedó bien seteado y el lector lo
  //    encuentra (AC-1).
  await page.goto('/mi-cuenta/compras');
  const fila = page.getByRole('link', { name: new RegExp(`Pedido #${orderNumber}\\b`) });
  await expect(fila).toBeVisible();

  // 5) El detalle — ítems, cantidad, estado y retiro (AC-2).
  await fila.click();
  await expect(page).toHaveURL(new RegExp(`/mi-cuenta/compras/${orderNumber}$`));
  await expect(page.getByRole('heading', { name: `Pedido #${orderNumber}` })).toBeVisible();
  await expect(page.getByRole('cell', { name: '1' }).first()).toBeVisible();
  await expect(page.getByText(/retiro en sucursal/i)).toBeVisible();
});
