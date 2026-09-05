import { adminAuth } from './admin-auth';
import { apiCall } from './api';
import { nuevaCategoria, nuevoProducto } from './builders';
import { nuevoInvitado, type Invitado } from './cart-client';
import { QA_API_BASE_URL } from './qa-env';

/**
 * Hermano de `seed-carrito.ts` — construye órdenes reales para la suite de
 * aceptación del panel de fulfillment (US-012). Design.md §D2 (OQ-QA-1).
 *
 * Dos pasos, **el segundo es el ÚNICO acceso al ORM de este archivo** (una
 * lectura de `order_number → id`, más el `UPDATE` de estado que el puente
 * documenta — ningún otro archivo de este seed toca la base directo):
 *
 *   1. 100% API real: checkout (`POST /v1/checkout`) crea la orden en
 *      `pending_payment` con ítems, comprador y total reales (US-008).
 *   2. Puente documentado y temporal (hasta que exista
 *      `POST /v1/admin/orders/{orderId}/confirm-payment`, US-023):
 *      `prisma.order.update({ status: 'new' })`. Es el único salto de estado
 *      que ningún endpoint expone todavía.
 *
 * Todo lo que sigue de `new` en adelante (`preparing`/`ready`/`delivered`)
 * pasa por el `PATCH` real del backend de US-012 — nunca por `INSERT`/`UPDATE`
 * directo en `order_status_history`.
 *
 * La línea de abajo es la ÚNICA de todo el archivo que instancia el cliente
 * del ORM (T1.1, closure-grade): el paquete es CJS y este paquete es ESM, así
 * que se toma el `default` y se destructura en una sola expresión, sin dejar
 * un segundo rastro del nombre de la clase en ningún comentario ni tipo.
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
  name: 'Comprador QA',
  email: 'comprador-qa@example.test',
  phone: '+54 351 555 0000',
};

export interface ItemDeCheckout {
  slug: string;
  quantity: number;
  /** El precio que el dueño le puso, para que los escenarios lo asserten sin adivinarlo. */
  priceArsCents: number;
  productName: string;
}

export interface OrdenSembrada {
  id: string;
  orderNumber: number;
  status: OrderStatus;
  buyer: CompradorInput;
  items: ItemDeCheckout[];
  totalArsCents: number;
}

let seq = 0;
const RUN = `QAORD${Date.now().toString(36)}`;

/** Producto publicado con stock, para armar el carrito del checkout de siembra. */
export async function productoParaCheckout(
  token: string,
  categoryId: string,
  over: Partial<{ price_ars_cents: number; stock: number }> = {},
): Promise<{ id: string; slug: string; sku: string; name: string; price_ars_cents: number }> {
  seq += 1;
  const creado = await apiCall<{
    id: string;
    slug: string;
    sku: string;
    name: string;
    price_ars_cents: number;
  }>(
    '/v1/admin/products',
    'POST',
    token,
    nuevoProducto(categoryId, {
      stock: 10,
      price_ars_cents: 850_000,
      ...over,
    }),
  );
  return apiCall(`/v1/admin/products/${creado.id}`, 'PATCH', token, {
    status: 'published',
  });
}

/** Categoría + N productos publicados listos para checkout de siembra. */
export async function catalogoParaCheckout(
  n: number,
): Promise<{ token: string; categoryId: string; productos: Awaited<ReturnType<typeof productoParaCheckout>>[] }> {
  const token = await adminAuth();
  const categoria = await apiCall<{ id: string }>(
    '/v1/admin/categories',
    'POST',
    token,
    nuevaCategoria(),
  );
  const productos = [];
  for (let i = 0; i < n; i += 1) {
    productos.push(await productoParaCheckout(token, categoria.id, { price_ars_cents: 850_000 + i * 100_000 }));
  }
  return { token, categoryId: categoria.id, productos };
}

/** Lee la cookie legible de CSRF del carrito; el checkout la exige igual que las escrituras del carrito. */
async function csrfDe(invitado: Invitado): Promise<string | undefined> {
  const estado = await invitado.ctx.storageState();
  return estado.cookies.find((c) => c.name === 'dsm_cart_csrf')?.value;
}

/**
 * Paso 1 — checkout 100% real. Arma el carrito del invitado y confirma la
 * compra; la orden nace en `pending_payment` (US-008), sin tocar el ORM directo.
 */
export async function checkoutReal(
  items: Array<{ slug: string; quantity: number }>,
  buyer: CompradorInput = COMPRADOR_DEFAULT,
): Promise<{ orderNumber: number; totalArsCents: number; itemsCount: number }> {
  const invitado = await nuevoInvitado();
  for (const item of items) {
    const resultado = await invitado.fijar(item.slug, item.quantity);
    if (resultado.status !== 200) {
      throw new Error(
        `seed-ordenes: no se pudo agregar ${item.slug} al carrito (status ${resultado.status})`,
      );
    }
  }
  const token = await csrfDe(invitado);
  const res = await invitado.ctx.post('/v1/checkout', {
    headers: token ? { 'x-csrf-token': token } : {},
    data: {
      buyer: { name: buyer.name, email: buyer.email, phone: buyer.phone },
      consent: true,
      fulfillment: 'pickup',
    },
  });
  if (res.status() !== 201) {
    throw new Error(
      `seed-ordenes: POST /v1/checkout devolvió ${res.status()} — ${await res.text()}`,
    );
  }
  const body = (await res.json()) as {
    order_number: number;
    total_ars_cents: number;
    items_count: number;
  };
  await invitado.cerrar();
  return {
    orderNumber: body.order_number,
    totalArsCents: body.total_ars_cents,
    itemsCount: body.items_count,
  };
}

/**
 * Paso 2 — el ÚNICO puente. Resuelve `order_number → id` (lectura) y anonimiza
 * el salto de estado que ningún endpoint expone todavía (`pending_payment →
 * new`, escritura). Ver design.md §D2 — revisitar cuando `US-023` publique
 * `POST /v1/admin/orders/{orderId}/confirm-payment`.
 */
export async function idPorOrderNumber(orderNumber: number): Promise<string> {
  const orden = await prisma.order.findUniqueOrThrow({ where: { order_number: orderNumber } });
  return orden.id;
}

export async function puentearANew(orderId: string): Promise<void> {
  await prisma.order.update({ where: { id: orderId }, data: { status: 'new' } });
}

/**
 * `cancelled` es el otro salto que ningún endpoint de este panel expone
 * (US-013 no existe todavía) — mismo puente, documentado igual (design.md §D2).
 */
export async function puentearACancelled(orderId: string): Promise<void> {
  await prisma.order.update({ where: { id: orderId }, data: { status: 'cancelled' } });
}

/** Avanza vía el `PATCH` REAL del backend de US-012 — nunca `INSERT`/`UPDATE` directo. */
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
  const body = await res.json().catch(() => undefined);
  return { status: res.status, body };
}

const ORDEN_DE_PASOS: Record<FulfillmentStatus, FulfillmentStatus[]> = {
  new: [],
  preparing: ['preparing'],
  ready: ['preparing', 'ready'],
  delivered: ['preparing', 'ready', 'delivered'],
};

/**
 * Siembra una orden real y la deja en el `status` pedido.
 *
 * - `pending_payment`: sólo el checkout, sin tocar el ORM directo.
 * - `new`: checkout + el único puente.
 * - `cancelled`: checkout + puente a `new` + puente a `cancelled` (§D2).
 * - `preparing`/`ready`/`delivered`: checkout + puente a `new` + los `PATCH`
 *   reales que hacen falta, en orden — nunca `order_status_history` directo.
 */
export async function crearOrdenEnEstado(
  target: OrderStatus,
  opts: {
    items?: Array<{ slug: string; quantity: number; priceArsCents: number; productName: string }>;
    buyer?: CompradorInput;
    adminToken?: string;
  } = {},
): Promise<OrdenSembrada> {
  const buyer = opts.buyer ?? COMPRADOR_DEFAULT;
  let items = opts.items;
  if (!items) {
    const { productos } = await catalogoParaCheckout(1);
    const p = productos[0]!;
    items = [{ slug: p.slug, quantity: 1, priceArsCents: p.price_ars_cents, productName: p.name }];
  }

  const checkout = await checkoutReal(
    items.map((i) => ({ slug: i.slug, quantity: i.quantity })),
    buyer,
  );
  const id = await idPorOrderNumber(checkout.orderNumber);

  if (target === 'pending_payment') {
    return {
      id,
      orderNumber: checkout.orderNumber,
      status: 'pending_payment',
      buyer,
      items,
      totalArsCents: checkout.totalArsCents,
    };
  }

  await puentearANew(id);

  if (target === 'cancelled') {
    await puentearACancelled(id);
    return {
      id,
      orderNumber: checkout.orderNumber,
      status: 'cancelled',
      buyer,
      items,
      totalArsCents: checkout.totalArsCents,
    };
  }

  const pasos = ORDEN_DE_PASOS[target as FulfillmentStatus];
  if (pasos.length > 0) {
    const adminToken = opts.adminToken ?? (await adminAuth());
    for (const paso of pasos) {
      const r = await avanzarEstado(adminToken, id, paso);
      if (r.status !== 200) {
        throw new Error(
          `seed-ordenes: PATCH a "${paso}" devolvió ${r.status} — ${JSON.stringify(r.body)}`,
        );
      }
    }
  }

  return {
    id,
    orderNumber: checkout.orderNumber,
    status: target,
    buyer,
    items,
    totalArsCents: checkout.totalArsCents,
  };
}

export { prisma as prismaDeSiembra };
