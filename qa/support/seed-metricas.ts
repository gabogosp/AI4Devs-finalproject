import { adminAuth } from './admin-auth';
import { apiCall } from './api';
import { nuevaCategoria, nuevoProducto } from './builders';
import { nuevoInvitado } from './cart-client';
import { QA_API_BASE_URL } from './qa-env';

/**
 * Hermano de `seed-ordenes.ts` (US-012) para el panel de métricas (US-016,
 * qa-plan.md §6). A diferencia de ese archivo, **no necesita el bridge vía
 * `@dsm/db`** que `seed-ordenes.ts` documentó en su momento para saltar
 * `pending_payment → new`: hoy `POST /v1/admin/orders/{id}/confirm-payment`
 * (US-023) y `POST /v1/checkout/simulate-payment` (US-010) ya existen, así
 * que las 6 órdenes de X-1 nacen 100% de endpoints reales.
 *
 * Resolución del `id` interno (UUID) sin tocar el ORM: en vez del
 * `idPorOrderNumber` de `seed-ordenes.ts` (lectura directa por Prisma),
 * este archivo lee `GET /v1/admin/orders/pending-payment` (US-023) — la
 * orden recién nacida por checkout SIEMPRE está ahí antes de confirmarse, y
 * esa lista trae `id`/`order_number` reales. Es la única diferencia
 * estructural con `seed-ordenes.ts`, y es lo que permite que este archivo no
 * tenga ninguna excepción de siembra salvo la documentada del clamp (abajo).
 *
 * **Única excepción documentada** (qa-plan.md §6, AC-9/C-2/QA-016-E2E-5):
 * backdatear `created_at` de una orden YA confirmada 100% por API real. No
 * existe ningún endpoint que fije esa fecha — el `UPDATE` de una sola
 * columna vía `@dsm/db` en `backdatearCreatedAt` es el ÚNICO acceso al ORM
 * de todo este archivo. `seed-metricas.smoke.ts` lo verifica.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const prisma = new ((await import('@dsm/db') as any).PrismaClient)();
const API = QA_API_BASE_URL;

export type FulfillmentStatus = 'new' | 'preparing' | 'ready' | 'delivered';
export type OrderStatus = FulfillmentStatus | 'pending_payment' | 'cancelled';

export interface CompradorInput {
  name: string;
  email: string;
  phone: string;
}

export const COMPRADOR_DEFAULT: CompradorInput = {
  name: 'Comprador Métricas QA',
  email: 'comprador-metricas-qa@example.test',
  phone: '+54 351 555 0000',
};

export interface ProductoParaMetricas {
  id: string;
  slug: string;
  sku: string;
  name: string;
  price_ars_cents: number;
}

export interface ItemDeCheckout {
  slug: string;
  quantity: number;
  /** El precio que el dueño le puso, para que los escenarios lo asserten sin adivinarlo. */
  priceArsCents: number;
  productName: string;
  productId: string;
}

export interface OrdenMetricas {
  id: string;
  orderNumber: number;
  orderToken: string;
  status: OrderStatus;
  buyer: CompradorInput;
  items: ItemDeCheckout[];
  totalArsCents: number;
}

let seq = 0;
const RUN = `QAMET${Date.now().toString(36)}`;

/** Producto publicado con stock, para armar el carrito del checkout de siembra. */
export async function productoParaMetricas(
  token: string,
  categoryId: string,
  over: Partial<{ price_ars_cents: number; stock: number }> = {},
): Promise<ProductoParaMetricas> {
  seq += 1;
  const creado = await apiCall<ProductoParaMetricas>(
    '/v1/admin/products',
    'POST',
    token,
    nuevoProducto(categoryId, {
      stock: 10,
      price_ars_cents: 850_000,
      ...over,
    }),
  );
  return apiCall<ProductoParaMetricas>(`/v1/admin/products/${creado.id}`, 'PATCH', token, {
    status: 'published',
  });
}

/** Categoría + N productos publicados listos para checkout de siembra. */
export async function catalogoParaMetricas(
  n: number,
  opts: { token?: string; priceStep?: number } = {},
): Promise<{ token: string; categoryId: string; productos: ProductoParaMetricas[] }> {
  const token = opts.token ?? (await adminAuth());
  const priceStep = opts.priceStep ?? 100_000;
  const categoria = await apiCall<{ id: string }>(
    '/v1/admin/categories',
    'POST',
    token,
    nuevaCategoria(),
  );
  const productos: ProductoParaMetricas[] = [];
  for (let i = 0; i < n; i += 1) {
    productos.push(
      await productoParaMetricas(token, categoria.id, { price_ars_cents: 850_000 + i * priceStep }),
    );
  }
  return { token, categoryId: categoria.id, productos };
}

/** Lee la cookie legible de CSRF del carrito; el checkout la exige igual que las escrituras del carrito. */
async function idPendientePorOrderNumber(
  adminToken: string,
  orderNumber: number,
): Promise<string> {
  const pendientes = await apiCall<Array<{ id: string; order_number: number }>>(
    '/v1/admin/orders/pending-payment',
    'GET',
    adminToken,
  );
  const fila = pendientes.find((f) => f.order_number === orderNumber);
  if (!fila) {
    throw new Error(
      `seed-metricas: la orden #${orderNumber} no aparece en GET /pending-payment — ` +
        '¿ya se confirmó o pasó más de lo esperado?',
    );
  }
  return fila.id;
}

/**
 * Checkout 100% real (US-008): arma el carrito del invitado, confirma la
 * compra, y resuelve el `id` interno vía `GET /pending-payment` (ver cabecera
 * del archivo). La orden nace en `pending_payment`, sin tocar el ORM.
 */
export async function checkoutReal(
  adminToken: string,
  items: ItemDeCheckout[],
  buyer: CompradorInput = COMPRADOR_DEFAULT,
): Promise<OrdenMetricas> {
  const invitado = await nuevoInvitado();
  for (const item of items) {
    const resultado = await invitado.fijar(item.slug, item.quantity);
    if (resultado.status !== 200) {
      throw new Error(
        `seed-metricas: no se pudo agregar ${item.slug} al carrito (status ${resultado.status})`,
      );
    }
  }
  const res = await invitado.checkout({
    buyer: { name: buyer.name, email: buyer.email, phone: buyer.phone },
    consent: true,
    fulfillment: 'pickup',
  });
  if (res.status !== 201) {
    throw new Error(`seed-metricas: POST /v1/checkout devolvió ${res.status}`);
  }
  await invitado.cerrar();

  const id = await idPendientePorOrderNumber(adminToken, res.body.order_number);

  return {
    id,
    orderNumber: res.body.order_number,
    orderToken: res.body.order_token,
    status: 'pending_payment',
    buyer,
    items,
    totalArsCents: res.body.total_ars_cents,
  };
}

/** `POST /v1/admin/orders/{id}/confirm-payment` real (US-023) — pending_payment → new. */
export async function confirmarPagoManual(
  adminToken: string,
  orderId: string,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${API}/v1/admin/orders/${orderId}/confirm-payment`, {
    method: 'POST',
    headers: { authorization: `Bearer ${adminToken}` },
  });
  return { status: res.status, body: await res.json().catch(() => undefined) };
}

/**
 * `POST /v1/checkout/simulate-payment` real (US-010) — medio automático que
 * NUNCA llama a MercadoPago (`design.md §D7`, ADR-0006). Con stock
 * suficiente confirma igual que `confirm-payment`; con stock insuficiente
 * dispara la cancelación + reembolso automáticos (`confirm-order.service.ts`
 * — misma rama que ejercita el webhook real).
 */
export async function simularPagoAutomatico(
  orderToken: string,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${API}/v1/checkout/simulate-payment`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ order_token: orderToken }),
  });
  return { status: res.status, body: await res.json().catch(() => undefined) };
}

/** Avanza vía el `PATCH` real del backend de US-012 — nunca `INSERT`/`UPDATE` directo. */
export async function avanzarEstado(
  adminToken: string,
  orderId: string,
  target: FulfillmentStatus,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${API}/v1/admin/orders/${orderId}`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ status: target }),
  });
  return { status: res.status, body: await res.json().catch(() => undefined) };
}

const PASOS_HASTA: Record<FulfillmentStatus, FulfillmentStatus[]> = {
  new: [],
  preparing: ['preparing'],
  ready: ['preparing', 'ready'],
  delivered: ['preparing', 'ready', 'delivered'],
};

export interface CrearOrdenOpts {
  adminToken?: string;
  buyer?: CompradorInput;
  items?: ItemDeCheckout[];
  catalogo?: { token: string; categoryId: string; productos: ProductoParaMetricas[] };
}

async function itemsPorDefecto(
  adminToken: string,
  catalogo?: CrearOrdenOpts['catalogo'],
): Promise<ItemDeCheckout[]> {
  const c = catalogo ?? (await catalogoParaMetricas(1, { token: adminToken }));
  const p = c.productos[0]!;
  return [
    {
      slug: p.slug,
      quantity: 1,
      priceArsCents: p.price_ars_cents,
      productName: p.name,
      productId: p.id,
    },
  ];
}

/**
 * Siembra una orden real y la deja en `pending_payment` (A de X-1) — ningún
 * paso adicional, ninguna cuenta como venta (N-2, AC-8).
 */
export async function crearOrdenPendiente(opts: CrearOrdenOpts = {}): Promise<OrdenMetricas> {
  const adminToken = opts.adminToken ?? (await adminAuth());
  const items = opts.items ?? (await itemsPorDefecto(adminToken, opts.catalogo));
  return checkoutReal(adminToken, items, opts.buyer);
}

/**
 * Siembra una orden real y la lleva, con endpoints reales, hasta `target`
 * (B/C/D/E de X-1: `new`/`preparing`/`ready`/`delivered`). Checkout real +
 * `confirm-payment` real + los `PATCH` reales que hagan falta, en orden.
 */
export async function crearOrdenActiva(
  target: FulfillmentStatus,
  opts: CrearOrdenOpts = {},
): Promise<OrdenMetricas> {
  const adminToken = opts.adminToken ?? (await adminAuth());
  const orden = await crearOrdenPendiente({ ...opts, adminToken });

  const confirmada = await confirmarPagoManual(adminToken, orden.id);
  if (confirmada.status !== 200) {
    throw new Error(
      `seed-metricas: confirm-payment de la orden #${orden.orderNumber} devolvió ${confirmada.status}`,
    );
  }

  for (const paso of PASOS_HASTA[target]) {
    const r = await avanzarEstado(adminToken, orden.id, paso);
    if (r.status !== 200) {
      throw new Error(
        `seed-metricas: PATCH a "${paso}" de la orden #${orden.orderNumber} devolvió ${r.status}`,
      );
    }
  }

  return { ...orden, status: target };
}

/**
 * Siembra una orden real cancelada por falta de stock (F de X-1, N-3): checkout
 * real con 1 unidad, se baja el stock del producto por debajo de lo pedido
 * (`PATCH /admin/products/{id}`, real) y se confirma por el medio AUTOMÁTICO
 * (`simulate-payment`, real) — el mismo camino que dispara la compensación
 * automática (reembolso) que el webhook real ejercita en `confirm-order.service.ts`.
 * La confirmación MANUAL (US-023) no cancela sola: responde 409 sin tocar la
 * orden — por eso este camino usa el medio automático a propósito.
 */
export async function crearOrdenCanceladaPorStock(
  opts: CrearOrdenOpts = {},
): Promise<OrdenMetricas> {
  const adminToken = opts.adminToken ?? (await adminAuth());
  const items = opts.items ?? (await itemsPorDefecto(adminToken, opts.catalogo));
  const orden = await checkoutReal(adminToken, items, opts.buyer);

  const productId = items[0]!.productId;
  await apiCall(`/v1/admin/products/${productId}`, 'PATCH', adminToken, { stock: 0 });

  const resultado = await simularPagoAutomatico(orden.orderToken);
  if (resultado.status !== 409) {
    throw new Error(
      `seed-metricas: simulate-payment con stock 0 debía devolver 409 (auto-cancelado), ` +
        `devolvió ${resultado.status} — ${JSON.stringify(resultado.body)}`,
    );
  }

  return { ...orden, status: 'cancelled' };
}

/**
 * ÚNICA excepción de siembra de este archivo (qa-plan.md §6/§7, AC-9):
 * backdatea `created_at` de una orden YA confirmada 100% por API real, para
 * ejercitar el clamp de retención sin esperar `ORDER_RETENTION_MONTHS`
 * reales. Ningún endpoint expone esta escritura.
 */
export async function backdatearCreatedAt(orderId: string, fecha: Date): Promise<void> {
  await prisma.order.update({ where: { id: orderId }, data: { created_at: fecha } });
}

export { prisma as prismaDeSiembra };
