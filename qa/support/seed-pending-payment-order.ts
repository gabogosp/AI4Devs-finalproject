import { adminAuth } from './admin-auth';
import { apiCall } from './api';
import { buildCheckoutBody, nuevaCategoria, nuevoProducto } from './builders';
import { nuevoInvitado } from './cart-client';

/**
 * US-023 §8 — drives el checkout REAL (nunca un INSERT directo) para dejar una
 * orden `pending_payment` genuina, tal como la crearía un comprador de verdad
 * (US-008).
 *
 * El `201` de `POST /v1/checkout` no expone el UUID interno de la orden — sólo
 * `order_token`/`order_number` (`CheckoutCreated`, `apps/api/docs/api/openapi.yaml`).
 * Para resolver el `id` que `POST /confirm-payment` necesita en el path, este
 * seed hace `GET /v1/admin/orders/pending-payment` (con un token admin) y busca
 * la fila cuyo `order_number` coincide — **dogfooding intencional de AC-2**: es
 * la única vía legítima, sin acceso a la base, para que un consumidor externo
 * descubra ese `id`.
 */
export interface PendingPaymentOrderSeed {
  /** UUID interno — el que espera el path de `POST /confirm-payment`. */
  id: string;
  orderNumber: number;
  buyerName: string;
  totalArsCents: number;
  /** Producto de la única línea de la orden — para verificar el decremento de stock. */
  productId: string;
  productSlug: string;
  /** Cantidad pedida de esa línea. */
  quantity: number;
  /** Stock del producto justo ANTES del checkout (después de sembrarlo, antes de comprarlo). */
  stockBefore: number;
}

export interface SeedPendingPaymentOrderOpts {
  /** Cantidad de la única línea de la orden. Default 2 (deja margen para decrementar y volver a verificar). */
  qty?: number;
}

export async function seedPendingPaymentOrder(
  opts: SeedPendingPaymentOrderOpts = {},
): Promise<PendingPaymentOrderSeed> {
  const qty = opts.qty ?? 2;
  const token = await adminAuth();

  // 1. Catálogo real: categoría + producto publicado con stock suficiente
  //    (qty + margen, para poder verificar "decrementado exactamente en qty"
  //    contra un valor que no llega a cero por accidente).
  const categoria = await apiCall<{ id: string }>(
    '/v1/admin/categories',
    'POST',
    token,
    nuevaCategoria(),
  );
  const stockInicial = qty + 5;
  const creado = await apiCall<{ id: string; slug: string }>(
    '/v1/admin/products',
    'POST',
    token,
    nuevoProducto(categoria.id, { stock: stockInicial }),
  );
  await apiCall(`/v1/admin/products/${creado.id}`, 'PATCH', token, {
    status: 'published',
  });

  // 2. Checkout real: invitado nuevo → agrega la línea → POST /v1/checkout.
  const invitado = await nuevoInvitado();
  const alta = await invitado.fijar(creado.slug, qty);
  if (alta.status !== 200) {
    await invitado.cerrar();
    throw new Error(
      `[qa/seed-pending-payment-order] no se pudo agregar ${creado.slug} x${qty} al carrito: ` +
        `${alta.status} ${JSON.stringify(alta.body)}`,
    );
  }

  const checkoutRes = await invitado.checkout(buildCheckoutBody());
  await invitado.cerrar();
  if (checkoutRes.status !== 201) {
    throw new Error(
      `[qa/seed-pending-payment-order] POST /v1/checkout → ${checkoutRes.status}: ` +
        `${JSON.stringify(checkoutRes.body)}`,
    );
  }
  const { order_number: orderNumber, total_ars_cents: totalArsCents } =
    checkoutRes.body;

  // 3. Resolver el UUID interno vía GET /pending-payment (AC-2), nunca por DB.
  const pendientes = await apiCall<
    Array<{
      id: string;
      order_number: number;
      buyer_name: string;
      total_ars_cents: number;
      created_at: string;
    }>
  >('/v1/admin/orders/pending-payment', 'GET', token);
  const fila = pendientes.find((p) => p.order_number === orderNumber);
  if (!fila) {
    throw new Error(
      `[qa/seed-pending-payment-order] la orden #${orderNumber} recién creada por checkout ` +
        'no aparece en GET /v1/admin/orders/pending-payment',
    );
  }

  return {
    id: fila.id,
    orderNumber: fila.order_number,
    buyerName: fila.buyer_name,
    totalArsCents: fila.total_ars_cents,
    productId: creado.id,
    productSlug: creado.slug,
    quantity: qty,
    stockBefore: stockInicial,
  };
}
