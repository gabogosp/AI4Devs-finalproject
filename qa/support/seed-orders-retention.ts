import { request } from '@playwright/test';
// `@dsm/db` es CJS y `@dsm/qa` es ESM: mismo patrón que
// `performance/seed-load-data.ts` — se toma el default y se destructura.
import db from '@dsm/db';
import { adminAuth } from './admin-auth';
import { apiCall } from './api';
import { QA_API_BASE_URL, QA_WEB_BASE_URL } from './qa-env';
import {
  buildOrderRetentionFixture,
  nuevaCategoria,
  nuevoProducto,
  type OrderRetentionFixture,
} from './builders';
import type { ProductoSembrado } from './seed-carrito';

const { PrismaClient } = db as unknown as { PrismaClient: new () => any };

const API = QA_API_BASE_URL;
const WEB = QA_WEB_BASE_URL;

/**
 * `openspec/changes/US-021-retencion-datos-ordenes-backend/qa-plan.md` §7 —
 * seed **específico de este change**, distinto de `seed-carrito.ts`/
 * `seed-checkout.ts` (este último **no existe todavía** en el repo — gap
 * compartido, ver la nota en `qa-plan.md`/el reporte de esta corrida; no se
 * construye acá, sería asumir el alcance de otro change).
 *
 * Crea órdenes reales vía `POST /v1/cart/items` + `POST /v1/checkout` (nunca
 * INSERT directo: así se respeta la validación de `CreateCheckoutDto`, el
 * snapshot de precio y el estado inicial real `pending_payment`), y luego usa
 * `POST /v1/admin/orders/:id/confirm-payment` (US-023, YA construido y en
 * `main`) para llevarlas a `status: 'new'` — **sin ese paso, la orden queda
 * `pending_payment` y ni `GET /v1/admin/orders` ni `GET .../:id` la muestran**
 * (`orders.controller.ts`/`order.dto.ts`: `ACTIVE_STATUSES` excluye
 * `pending_payment`, y el detalle devuelve 404 sobre ella) — varias de las
 * escenas de este `qa-plan` usan esos dos GET como proxy de AC-2/5/6, así que
 * sin confirmar el pago no habría nada que consultar.
 *
 * Recién con la orden en `new` se **retrasa `created_at`** de las que deben
 * quedar "vencidas", usando `@dsm/db` (Prisma) directamente — excepción
 * documentada al patrón "todo seed pasa por la API real" (igual que
 * `performance/seed-load-data.ts`): la API nunca acepta `created_at` como
 * parámetro, y es exactamente lo que hace falta para ejercitar el corte de
 * retención sin esperar `ORDER_RETENTION_MONTHS` reales.
 */

export interface OrdenRetencionSembrada {
  /** UUID interno — el que consumen los dos endpoints de este change. */
  id: string;
  orderNumber: number;
  orderToken: string;
  buyerName: string;
  buyerEmail: string;
  buyerPhone: string;
  totalArsCents: number;
  itemsCount: number;
  createdAt: Date;
}

export interface SeedOrdenesRetencionOptions {
  /** Cuántas quedan con `created_at` corrido más allá del corte de retención. */
  vencidas?: number;
  /** Cuántas quedan con `created_at` de "ahora" (dentro de la ventana). */
  recientes?: number;
  /** Default: `ORDER_RETENTION_MONTHS` del entorno, o 12 (mismo default que `design.md`). */
  retentionMonths?: number;
  /**
   * Token admin ya obtenido (p. ej. `this.token` del `Before` de `world.ts`) —
   * evita un segundo login real por seed y el consumo doble del presupuesto de
   * `POST /v1/admin/auth/login` (`admin-auth.ts`, 5 cada 15 min en producción).
   */
  token?: string;
}

export interface SeedOrdenesRetencionResult {
  token: string;
  categoryId: string;
  producto: ProductoSembrado;
  retentionMonths: number;
  vencidas: OrdenRetencionSembrada[];
  recientes: OrdenRetencionSembrada[];
}

export async function seedOrdenesRetencion(
  opts: SeedOrdenesRetencionOptions = {},
): Promise<SeedOrdenesRetencionResult> {
  const cantidadVencidas = opts.vencidas ?? 0;
  const cantidadRecientes = opts.recientes ?? 0;
  const retentionMonths =
    opts.retentionMonths ?? Number(process.env.ORDER_RETENTION_MONTHS ?? 12);

  const token = opts.token ?? (await adminAuth());

  const category = await apiCall<{ id: string }>(
    '/v1/admin/categories',
    'POST',
    token,
    nuevaCategoria(),
  );
  const creado = await apiCall<ProductoSembrado>(
    '/v1/admin/products',
    'POST',
    token,
    nuevoProducto(category.id, { stock: 1000 }),
  );
  const producto = await apiCall<ProductoSembrado>(
    `/v1/admin/products/${creado.id}`,
    'PATCH',
    token,
    { status: 'published' },
  );

  const prisma = new PrismaClient();
  try {
    const crearOrden = async (): Promise<OrdenRetencionSembrada> => {
      const fixture = buildOrderRetentionFixture();
      const checkout = await crearOrdenViaCheckout(producto.slug, fixture);

      const fila = await prisma.order.findUnique({
        where: { order_number: checkout.order_number },
      });
      if (!fila) {
        throw new Error(
          `[seed-orders-retention] la orden #${checkout.order_number} no aparece en Postgres tras el checkout`,
        );
      }

      // Sin confirmar el pago la orden queda `pending_payment` — invisible
      // para los dos GET admin que este plan usa como proxy (ver cabecera).
      await apiCall(`/v1/admin/orders/${fila.id}/confirm-payment`, 'POST', token);

      return {
        id: fila.id,
        orderNumber: fila.order_number,
        orderToken: checkout.order_token,
        buyerName: fixture.buyerName,
        buyerEmail: fixture.buyerEmail,
        buyerPhone: fixture.buyerPhone,
        totalArsCents: checkout.total_ars_cents,
        itemsCount: checkout.items_count,
        createdAt: fila.created_at,
      };
    };

    const recientes: OrdenRetencionSembrada[] = [];
    for (let i = 0; i < cantidadRecientes; i += 1) recientes.push(await crearOrden());

    const vencidas: OrdenRetencionSembrada[] = [];
    for (let i = 0; i < cantidadVencidas; i += 1) {
      const orden = await crearOrden();
      // Un mes extra de margen sobre el corte: no depende de cuánto tarda esta
      // misma función en correr para quedar "claramente" vencida (el borde
      // exacto del corte lo explora el charter 2 de §8, no este seed).
      const backdate = new Date();
      backdate.setMonth(backdate.getMonth() - retentionMonths - 1);
      await prisma.order.update({
        where: { id: orden.id },
        data: { created_at: backdate },
      });
      vencidas.push({ ...orden, createdAt: backdate });
    }

    return {
      token,
      categoryId: category.id,
      producto,
      retentionMonths,
      vencidas,
      recientes,
    };
  } finally {
    await prisma.$disconnect();
  }
}

interface RespuestaCheckout {
  order_token: string;
  order_number: number;
  status: string;
  total_ars_cents: number;
  items_count: number;
}

/**
 * Cliente-invitado descartable: agrega 1 unidad al carrito y confirma el
 * checkout, mismo flujo de dos escrituras que un comprador real (`fijar` +
 * `POST /v1/checkout`, `qa/support/cart-client.ts` + `checkout.controller.ts`).
 * No reusa `Invitado` de `cart-client.ts` porque ese cliente no expone
 * checkout — se duplica sólo el mínimo (lectura del cookie CSRF) acá.
 */
async function crearOrdenViaCheckout(
  slugProducto: string,
  fixture: OrderRetentionFixture,
): Promise<RespuestaCheckout> {
  const ctx = await request.newContext({
    baseURL: API,
    // `CartCsrfGuard` verifica `Origin` contra la allowlist además del
    // double-submit — mismo requisito que `cart-client.ts`.
    extraHTTPHeaders: { origin: WEB },
  });
  try {
    // Primera escritura sin cookie de carrito: pasa sin CSRF (CartCsrfGuard) y
    // es la que emite la cookie + el CSRF token que el checkout sí exige.
    const alta = await ctx.put(`/v1/cart/items/${slugProducto}`, {
      data: { quantity: 1 },
    });
    if (alta.status() !== 200) {
      throw new Error(
        `[seed-orders-retention] PUT /v1/cart/items/${slugProducto} → ${alta.status()}`,
      );
    }

    const estado = await ctx.storageState();
    const csrf = estado.cookies.find((c) => c.name === 'dsm_cart_csrf')?.value;

    const res = await ctx.post('/v1/checkout', {
      data: {
        buyer: {
          name: fixture.buyerName,
          email: fixture.buyerEmail,
          phone: fixture.buyerPhone,
        },
        consent: true,
        fulfillment: 'pickup',
      },
      headers: csrf ? { 'x-csrf-token': csrf } : {},
    });
    if (res.status() !== 201) {
      const detalle = await res.text().catch(() => '');
      throw new Error(
        `[seed-orders-retention] POST /v1/checkout → ${res.status()}: ${detalle.slice(0, 300)}`,
      );
    }
    return (await res.json()) as RespuestaCheckout;
  } finally {
    await ctx.dispose();
  }
}
