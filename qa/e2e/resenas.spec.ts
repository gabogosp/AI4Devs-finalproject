import { expect, test } from '@playwright/test';
import { datosDeCuenta } from '../support/customer-auth';
import { catalogoParaCheckout, idPorOrderNumber, avanzarEstado } from '../support/seed-ordenes';
import { QA_API_BASE_URL } from '../support/qa-env';

/**
 * QA-025-E2E-1/2 (US-025, `qa-plan.md` §5) + el escenario de moderación por
 * UI agregado por pedido de la coordinadora tras cerrar TC-731 (US-022).
 *
 * Mismo patrón que `cuenta-compras-cross-stack.spec.ts` (US-015): todo por
 * el navegador real contra la app construida — sin inyectar cookies ni
 * tocar `APIRequestContext` para las acciones del cliente. Las únicas
 * llamadas fuera del navegador son las que no tienen botón en la UI:
 * `simulate-payment` (medio de test/demo, US-010) y el avance de estado
 * admin hasta `delivered` (`avanzarEstado`, mismo helper que
 * `crearOrdenEnEstado` — acá se llama a mano porque el pedido nace del
 * checkout real por UI, no de un seed que arranca de cero).
 *
 * Elegibilidad para reseñar exige una orden `delivered` (AC-1/AC-6) —
 * ninguna de las tres etapas (`preparing`/`ready`/`delivered`) tiene un
 * botón propio distinto del panel de fulfillment (US-012), así que se
 * avanza por API real, nunca `UPDATE` directo.
 */

async function comprarHastaDelivered(
  page: import('@playwright/test').Page,
  slug: string,
  cuenta: { nombre: string; email: string; password: string },
  adminToken: string,
): Promise<number> {
  // 1) Registro real por la UI — deja sesión activa (US-014 AC-1).
  await page.goto('/crear-cuenta');
  await page.getByLabel(/nombre/i).fill(cuenta.nombre);
  await page.getByLabel(/email/i).fill(cuenta.email);
  await page.getByLabel(/contraseña/i).fill(cuenta.password);
  await Promise.all([
    page.waitForResponse('**/v1/auth/register'),
    page.getByRole('button', { name: /crear cuenta/i }).click(),
  ]);
  await expect(page).toHaveURL(/\/mi-cuenta$/);

  // 2) Checkout real por la UI, mismos selectores que checkout-happy-path.
  await page.goto(`/productos/${slug}`);
  await Promise.all([
    page.waitForResponse('**/v1/cart/items/**'),
    page.getByRole('button', { name: /agregar al carrito/i }).click(),
  ]);

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
  const { order_token: orderToken, order_number: orderNumber } = (await checkoutRes.json()) as {
    order_token: string;
    order_number: number;
  };

  // 3) Confirmar el pago (medio simulado "DSM") — sin cookie, sin UI propia.
  const confirm = await fetch(`${QA_API_BASE_URL}/v1/checkout/simulate-payment`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ order_token: orderToken }),
  });
  expect(confirm.status, await confirm.text()).toBe(200);

  // 4) Avanzar hasta `delivered` — sin botón propio distinto de US-012, vía
  //    los mismos PATCH admin reales que `crearOrdenEnEstado` encadena.
  const orderId = await idPorOrderNumber(orderNumber);
  for (const paso of ['preparing', 'ready', 'delivered'] as const) {
    const r = await avanzarEstado(adminToken, orderId, paso);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
  }

  return orderNumber;
}

test('QA-025-E2E-1 — el cliente con pedido entregado deja y edita su reseña, ve el promedio actualizado (AC-1, AC-2, AC-3, AC-5)', async ({
  page,
}) => {
  const { token, productos } = await catalogoParaCheckout(1);
  const producto = productos[0]!;
  const cuenta = datosDeCuenta('-e2e-resena');

  await comprarHastaDelivered(page, producto.slug, cuenta, token);

  // 5) Volver a la ficha, en el MISMO navegador logueado — ahí vive el form.
  await page.goto(`/productos/${producto.slug}`);
  const grupo = page.getByRole('radiogroup', { name: /calificación/i });
  await expect(grupo).toBeVisible();

  await page.getByRole('radio', { name: '4 de 5 estrellas' }).click();
  await page.getByLabel(/comentario/i).fill('Anduvo bien, tardó lo esperado');
  await Promise.all([
    page.waitForResponse((res) => res.url().includes('/v1/me/reviews/') && res.request().method() === 'PUT'),
    page.getByRole('button', { name: /publicar reseña/i }).click(),
  ]);

  // El promedio se refetchea real (AC-3) — 1 reseña propia de 4 estrellas.
  await expect(page.getByText('4.0')).toBeVisible();
  await expect(page.getByText('1 reseñas')).toBeVisible();
  // `getByText` a secas matchea también el <textarea> (todavía con el mismo
  // valor que se acaba de tipear) — se acota al `<li>` del ítem de la lista.
  await expect(
    page.locator('li', { hasText: 'Anduvo bien, tardó lo esperado' }),
  ).toBeVisible();
  await expect(page.getByText('Vos')).toBeVisible();

  // AC-5: editar — el form ya arranca en modo edición ("Guardar cambios"),
  // NO crea una segunda reseña (el conteo se queda en 1).
  await expect(page.getByRole('button', { name: /guardar cambios/i })).toBeVisible();
  await page.getByRole('radio', { name: '5 de 5 estrellas' }).click();
  await Promise.all([
    page.waitForResponse((res) => res.url().includes('/v1/me/reviews/') && res.request().method() === 'PUT'),
    page.getByRole('button', { name: /guardar cambios/i }).click(),
  ]);
  await expect(page.getByText('5.0')).toBeVisible();
  await expect(page.getByText('1 reseñas')).toBeVisible();
});

test('QA-025-E2E-2a — un cliente logueado que nunca compró el producto no ve ningún control de reseña (AC-6)', async ({
  page,
}) => {
  const { productos } = await catalogoParaCheckout(1);
  const producto = productos[0]!;
  const cuenta = datosDeCuenta('-e2e-resena-n1');

  await page.goto('/crear-cuenta');
  await page.getByLabel(/nombre/i).fill(cuenta.nombre);
  await page.getByLabel(/email/i).fill(cuenta.email);
  await page.getByLabel(/contraseña/i).fill(cuenta.password);
  await Promise.all([
    page.waitForResponse('**/v1/auth/register'),
    page.getByRole('button', { name: /crear cuenta/i }).click(),
  ]);

  await page.goto(`/productos/${producto.slug}`);
  await expect(page.getByRole('heading', { name: producto.name })).toBeVisible();
  await expect(page.getByRole('radiogroup', { name: /calificación/i })).toHaveCount(0);
});

test('QA-025-E2E-2b — un visitante sin sesión no ve ningún control de reseña y ve la invitación a crear cuenta (AC-7)', async ({
  page,
}) => {
  const { productos } = await catalogoParaCheckout(1);
  const producto = productos[0]!;

  await page.goto(`/productos/${producto.slug}`);
  await expect(page.getByRole('heading', { name: producto.name })).toBeVisible();
  await expect(page.getByRole('radiogroup', { name: /calificación/i })).toHaveCount(0);
  await expect(page.getByText(/necesitás una cuenta para dejar una reseña/i)).toBeVisible();
});

test('el dueño oculta una reseña desde el panel admin — deja de verse en la ficha pública (AC-8, UI)', async ({
  page,
}) => {
  const { token, productos } = await catalogoParaCheckout(1);
  const producto = productos[0]!;
  const cuenta = datosDeCuenta('-e2e-resena-mod');

  await comprarHastaDelivered(page, producto.slug, cuenta, token);

  await page.goto(`/productos/${producto.slug}`);
  await page.getByRole('radio', { name: '2 de 5 estrellas' }).click();
  await page.getByLabel(/comentario/i).fill('Ofensivo (seed E2E)');
  await Promise.all([
    page.waitForResponse((res) => res.url().includes('/v1/me/reviews/') && res.request().method() === 'PUT'),
    page.getByRole('button', { name: /publicar reseña/i }).click(),
  ]);
  await expect(page.getByText('2.0')).toBeVisible();

  // El admin entra por la UI real (bootstrap token, mismo form que un dueño
  // usaría) — no se inyecta el token en `sessionStorage` a mano.
  await page.goto('/admin/acceso');
  await page.getByLabel(/token de acceso/i).fill(process.env.ADMIN_BOOTSTRAP_TOKEN ?? '');
  await page.getByRole('button', { name: /entrar/i }).click();
  await expect(page).toHaveURL(/\/admin\/productos$/);

  await page.goto(`/admin/productos/${producto.id}`);
  await expect(page.getByRole('heading', { name: /moderación de reseñas/i })).toBeVisible();
  const filaModeracion = page.getByText('Ofensivo (seed E2E)');
  await expect(filaModeracion).toBeVisible();
  await Promise.all([
    page.waitForResponse((res) => res.url().includes('/v1/admin/reviews/') && res.request().method() === 'PATCH'),
    page.getByRole('button', { name: /^ocultar$/i }).click(),
  ]);

  // La verificación real: NAVEGACIÓN NUEVA a la ficha pública (no el estado
  // optimista del propio panel admin, que `ProductReviewsModeration.tsx`
  // documenta como sólo-en-memoria) — así se prueba el efecto server-side.
  await page.goto(`/productos/${producto.slug}`);
  await expect(page.getByText('Sin reseñas todavía')).toBeVisible();
  await expect(page.getByText('Ofensivo (seed E2E)')).toHaveCount(0);
});
