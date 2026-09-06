import { expect, request, test } from '@playwright/test';
import { adminAuth } from '../support/admin-auth';
import { apiCall } from '../support/api';
import { buildBuyerData, nuevaCategoria, nuevoProducto } from '../support/builders';
import { QA_API_BASE_URL } from '../support/qa-env';
import { seedPendingPaymentOrder } from '../support/seed-pending-payment-order';

/**
 * QA-010-E2E-1/E2E-2 (`qa-plan.md` §8, `design.md` §D-QA8) — Layer 3
 * cross-stack: cruza US-008 (checkout FE), US-010 (webhook/medio simulado
 * BE) y US-012 (panel del dueño FE).
 *
 * No existe ningún botón "pagar con medio simulado" en `apps/web`
 * (verificado: `grep -rn "simulate-payment" apps/web/src` no devuelve nada —
 * superficie de test/demo, sin consumidor FE) — el tramo de confirmación usa
 * `APIRequestContext` directo, nunca la UI.
 */

async function sembrarProductoPublicado(stock: number): Promise<{ id: string; slug: string }> {
  const token = await adminAuth();
  const categoria = await apiCall<{ id: string }>(
    '/v1/admin/categories',
    'POST',
    token,
    nuevaCategoria(),
  );
  const producto = await apiCall<{ id: string; slug: string }>(
    '/v1/admin/products',
    'POST',
    token,
    nuevoProducto(categoria.id, { stock }),
  );
  await apiCall(`/v1/admin/products/${producto.id}`, 'PATCH', token, { status: 'published' });
  return producto;
}

test('SC-010-X1 — loop completo: comprador paga con el medio simulado y el dueño ve la orden nueva (AC-1, AC-9)', async ({
  page,
}) => {
  const STOCK_INICIAL = 5;
  const producto = await sembrarProductoPublicado(STOCK_INICIAL);

  // 1) Checkout REAL por la UI (mismos selectores por rol/label que
  //    `apps/web/e2e/checkout-happy-path.spec.ts`, contra la API real).
  await page.goto(`/productos/${producto.slug}`);
  const [agregar] = await Promise.all([
    page.waitForResponse('**/v1/cart/items/**'),
    page.getByRole('button', { name: /agregar al carrito/i }).click(),
  ]);
  expect(agregar.status(), await agregar.text()).toBe(200);

  await page.goto('/carrito');
  await expect(page.getByRole('button', { name: /ir al pago/i })).toBeEnabled();
  await page.getByRole('button', { name: /ir al pago/i }).click();
  await expect(page).toHaveURL(/\/checkout$/);

  const buyer = buildBuyerData();
  await page.getByLabel(/nombre/i).fill(buyer.name);
  await page.getByLabel(/email/i).fill(buyer.email);
  await page.getByLabel(/teléfono/i).fill(buyer.phone);
  await page.getByRole('checkbox').check();

  // 2) El `order_token` se extrae de la RESPUESTA DE RED — el componente lo
  //    guarda en estado de React pero no lo renderiza (correcto: es un
  //    secreto de un solo uso, `design.md` §D-QA8). Extraerlo del DOM no es
  //    posible ni deseable.
  const [checkoutRes] = await Promise.all([
    page.waitForResponse('**/v1/checkout'),
    page.getByRole('button', { name: /confirmar pedido/i }).click(),
  ]);
  expect(checkoutRes.status()).toBe(201);
  const checkoutBody = (await checkoutRes.json()) as { order_token: string; order_number: number };
  const { order_token: orderToken, order_number: orderNumber } = checkoutBody;

  await expect(page.getByRole('heading', { name: /pedido quedó registrado/i })).toBeVisible();

  // 3) Confirmación por el medio simulado — vía `APIRequestContext`, no hay
  //    botón FE para esto.
  const anon = await request.newContext({ baseURL: QA_API_BASE_URL });
  const simRes = await anon.post('/v1/checkout/simulate-payment', {
    data: { order_token: orderToken },
  });
  expect(simRes.status(), await simRes.text()).toBe(200);
  await anon.dispose();

  // 4) Panel del dueño (`/admin/ordenes`, ya construido por US-012): la
  //    orden aparece como "nueva" en la cola operativa.
  const adminToken = await adminAuth();
  await page.addInitScript((token) => {
    window.sessionStorage.setItem('dsm.admin.token', token);
  }, adminToken);
  await page.goto('/admin/ordenes');
  await expect(page.getByRole('table')).toBeVisible();

  const fila = page.getByRole('row').filter({ hasText: String(orderNumber) });
  await expect(fila).toBeVisible();
  await expect(fila.getByText('Nueva', { exact: true })).toBeVisible();

  // 5) El catálogo del dueño refleja el stock decrementado.
  const stockDto = await apiCall<{ stock: number }>(
    `/v1/admin/products/${producto.id}`,
    'GET',
    adminToken,
  );
  expect(stockDto.stock).toBe(STOCK_INICIAL - 1);
});

test('SC-010-X2 — una orden auto-cancelada por falta de stock nunca aparece accionable para el dueño (AC-4)', async ({
  page,
}) => {
  // Sembrado vía API (mismo fixture que SC-010-N3) — no repite el tramo de
  // checkout por UI, ya cubierto por SC-010-X1 (`tasks.md` T4.2).
  const seed = await seedPendingPaymentOrder({ qty: 2 });
  const adminToken = await adminAuth();
  const bajado = Math.max(0, seed.quantity - 1);
  await apiCall(`/v1/admin/products/${seed.productId}`, 'PATCH', adminToken, { stock: bajado });

  const anon = await request.newContext({ baseURL: QA_API_BASE_URL });
  const simRes = await anon.post('/v1/checkout/simulate-payment', {
    data: { order_token: seed.orderToken },
  });
  expect(simRes.status(), await simRes.text()).toBe(409);
  await anon.dispose();

  await page.addInitScript((token) => {
    window.sessionStorage.setItem('dsm.admin.token', token);
  }, adminToken);
  await page.goto('/admin/ordenes');
  // Espera al fin de la carga (spinner ausente) antes de asertar ausencia —
  // per `US-012` la cola excluye `pending_payment`/`cancelled` por diseño
  // (AC-8); este escenario lo verifica desde datos reales que US-010
  // produce (auto-cancelación), no repite la cobertura ya hecha por
  // `US-012-panel-ordenes-dueno-qa` sobre datos sembrados directo.
  await expect(page.getByText('Cargando órdenes…')).toHaveCount(0);
  await expect(page.getByText(String(seed.orderNumber))).toHaveCount(0);
});
