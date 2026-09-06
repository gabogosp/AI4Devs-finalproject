import { Injectable } from '@nestjs/common';
import { Order, OrderItem, Prisma } from '@dsm/db';
import { PrismaService } from '../prisma/prisma.service';
import { ValidationError } from '../common/errors/domain-errors';
import { isPrismaError, PRISMA_FK_VIOLATION } from '../common/prisma-errors';
import {
  ANONYMIZED_BUYER_EMAIL,
  ANONYMIZED_BUYER_NAME,
  ANONYMIZED_BUYER_PHONE,
  AnonymizationReason,
} from './order-anonymization';

/** US-015 — filtro de `listByCustomer`: ventana de retención + paginación. */
export interface ListOrdersByCustomerFilter {
  cutoff: Date;
  limit: number;
  offset: number;
}

/**
 * US-020 (decisión del PO §10.5) — estados que bloquean el borrado de cuenta:
 * el cliente tiene una compra en curso que todavía puede requerir contactarlo
 * (reclamo de pago, entrega). `delivered`/`cancelled` no bloquean: ya están
 * cerradas.
 */
export const BLOCKING_ORDER_STATUSES = [
  'pending_payment',
  'new',
  'preparing',
  'ready',
] as const;

export interface ListOrdersFilter {
  statusIn: string[];
  sortField: 'order_number' | 'created_at' | 'total_ars_cents';
  sortDesc: boolean;
  limit: number;
  offset: number;
}

export interface CreatePendingOrderLine {
  productId: string;
  quantity: number;
  unitPriceArsCents: number;
  productName: string;
  productSku: string;
}

export interface CreatePendingOrderData {
  accessTokenHash: string;
  /** US-015 — sesión de cliente resuelta por `OptionalCustomerGuard`, si existe. */
  customerId?: string;
  buyerName: string;
  buyerEmail: string;
  buyerPhone: string;
  totalArsCents: number;
  consentAcceptedAt: Date;
  consentTermsVersion: string;
  lines: CreatePendingOrderLine[];
}

export type OrderWithItems = Order & { items: OrderItem[] };

/**
 * Único punto de ORM para `orders` + `order_items` (§5). Ningún otro archivo del
 * repo toca `PrismaService` para estas dos tablas — T1.2 lo prueba con un `rg`,
 * no sólo con revisión.
 *
 * `createPendingOrder` es la única escritura: la orden y sus líneas nacen en la
 * MISMA transacción. Un fallo en cualquier línea deja cero filas — no hay
 * órdenes sin ítems, igual que `upsertItemAndTouch` del carrito (§5, transacción
 * para el caso de uso multi-escritura).
 */
@Injectable()
export class OrdersRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createPendingOrder(data: CreatePendingOrderData): Promise<OrderWithItems> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        return tx.order.create({
          data: {
            access_token_hash: data.accessTokenHash,
            // US-015 — mismo INSERT que ya existía, sin transacción nueva: la
            // columna/FK/índice ya están en el schema. `?? null` preserva el
            // comportamiento actual sin sesión (guest, exactamente como hoy).
            customer_id: data.customerId ?? null,
            buyer_name: data.buyerName,
            buyer_email: data.buyerEmail,
            buyer_phone: data.buyerPhone,
            total_ars_cents: data.totalArsCents,
            consent_accepted: true,
            consent_accepted_at: data.consentAcceptedAt,
            consent_terms_version: data.consentTermsVersion,
            items: {
              create: data.lines.map((linea) => ({
                product_id: linea.productId,
                quantity: linea.quantity,
                unit_price_ars_cents: linea.unitPriceArsCents,
                product_name: linea.productName,
                product_sku: linea.productSku,
              })),
            },
          },
          include: { items: true },
        });
      });
    } catch (error) {
      throw this.translate(error);
    }
  }

  /**
   * Orden por hash del token de acceso. US-009 no la usa —consume su propio
   * lookup sobre el mismo `access_token_hash`— por eso vive acá y no se exporta
   * más que a `CheckoutModule`.
   */
  findByTokenHash(tokenHash: string): Promise<OrderWithItems | null> {
    return this.prisma.order.findUnique({
      where: { access_token_hash: tokenHash },
      include: { items: true },
    });
  }

  /**
   * Listado del historial de compras del cliente autenticado (US-015 AC-1,
   * AC-4, AC-7, design.md §D3). Autorización estructural: `customer_id` y el
   * corte de retención viajan en el mismo `WHERE` que arma la query — no hay
   * ruta donde una orden ajena o fuera de ventana llegue a construirse antes
   * del chequeo (`threat-modeling-lite`, superficie 4). Excluye
   * `pending_payment`: un checkout iniciado y nunca pagado no es una "compra".
   */
  async listByCustomer(
    customerId: string,
    filter: ListOrdersByCustomerFilter,
  ): Promise<{ data: Order[]; total: number }> {
    const where = {
      customer_id: customerId,
      status: { not: 'pending_payment' },
      created_at: { gte: filter.cutoff },
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        orderBy: { created_at: 'desc' },
        take: filter.limit,
        skip: filter.offset,
      }),
      this.prisma.order.count({ where }),
    ]);
    return { data, total };
  }

  /**
   * Órdenes bloqueantes del borrado de cuenta (US-020, decisión §10.5):
   * cualquier orden del cliente en uno de los 4 estados en curso. Acepta
   * `tx` opcional porque `AccountDeletionService` la llama como la PRIMERA
   * lectura dentro de la misma transacción que hace todas las escrituras del
   * borrado — el chequeo y las escrituras comparten la misma serialización de
   * Postgres, así que la ventana de carrera es la duración de la transacción,
   * no el tiempo de pensar del usuario entre leer el aviso y confirmar.
   */
  listBlockingForCustomer(
    customerId: string,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<Order[]> {
    return tx.order.findMany({
      where: { customer_id: customerId, status: { in: [...BLOCKING_ORDER_STATUSES] } },
      orderBy: { created_at: 'desc' },
    });
  }

  /**
   * Detalle del historial de compras del cliente autenticado (US-015 AC-2,
   * AC-4, AC-5, AC-7, design.md §D3). NO distingue "orden inexistente" de
   * "orden ajena" ni de "fuera de retención" — las tres colapsan a `null` →
   * 404 (`OrderNotFoundError`), la misma disciplina IDOR que `listByCustomer`:
   * la propiedad se verifica en la query, nunca en un `if` después de traerla.
   */
  findByOrderNumberForCustomer(
    orderNumber: number,
    customerId: string,
    cutoff: Date,
  ): Promise<OrderWithItems | null> {
    return this.prisma.order.findFirst({
      where: {
        order_number: orderNumber,
        customer_id: customerId,
        status: { not: 'pending_payment' },
        created_at: { gte: cutoff },
      },
      include: { items: true },
    });
  }

  /**
   * Listado admin (US-012 AC-1, AC-5, AC-8). El allowlist de `statusIn` lo
   * decide el service — este método ejecuta lo que se le pasa (capas,
   * `backend-node-standards.md §2`; design.md §D6 — `pending_payment` nunca
   * sale de acá porque el service nunca lo incluye en `statusIn`).
   */
  async list(filter: ListOrdersFilter): Promise<{ data: Order[]; total: number }> {
    const where = { status: { in: filter.statusIn } };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        orderBy: { [filter.sortField]: filter.sortDesc ? 'desc' : 'asc' },
        take: filter.limit,
        skip: filter.offset,
      }),
      this.prisma.order.count({ where }),
    ]);
    return { data, total };
  }

  /**
   * Detalle admin (US-012 AC-2 / US-021 retención) / por id interno (US-023):
   * `ConfirmOrderService` la usa para distinguir 404 (orden inexistente) de 409
   * (existe pero no está `pending_payment`), algo que `transitionToNewIfPending`
   * por sí sola no puede — su `updateMany` guardado devuelve 0 filas afectadas
   * en ambos casos por igual. Devuelve la orden para CUALQUIER `status`
   * existente — el filtro de AC-8 sobre `pending_payment` es responsabilidad
   * del service, no de este método (mismas capas que `list`). Sin
   * `status_history` (T4.1 — `OrderStatusHistoryRepository` es el único punto
   * de ORM de esa tabla, no este archivo). `tx` opcional: se re-lee dentro de
   * la misma transacción cuando `updateStatusConditional` pierde la carrera
   * (design.md §D4).
   */
  findById(
    id: string,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<OrderWithItems | null> {
    return tx.order.findUnique({
      where: { id },
      include: { items: true },
    });
  }

  /**
   * Guardado por `anonymized_at: null` en el WHERE — atómico: dos llamadas
   * concurrentes sobre la misma orden serializan en Postgres; la segunda no
   * matchea nada (count 0), ninguna hace un segundo `UPDATE` ni dispara un
   * segundo evento (AC-8, y la parte de "Repudiation"/carrera de la superficie 2
   * de `threat-modeling-lite`).
   */
  async anonymize(
    id: string,
    reason: AnonymizationReason,
  ): Promise<{ anonymizedAt: Date; anonymizationReason: AnonymizationReason } | null> {
    await this.prisma.order.updateMany({
      where: { id, anonymized_at: null },
      data: {
        buyer_name: ANONYMIZED_BUYER_NAME,
        buyer_email: ANONYMIZED_BUYER_EMAIL,
        buyer_phone: ANONYMIZED_BUYER_PHONE,
        anonymized_at: new Date(),
        anonymization_reason: reason,
      },
    });
    const row = await this.prisma.order.findUnique({
      where: { id },
      select: { anonymized_at: true, anonymization_reason: true },
    });
    if (!row || !row.anonymized_at) return null;
    return {
      anonymizedAt: row.anonymized_at,
      anonymizationReason: row.anonymization_reason as AnonymizationReason,
    };
  }

  /**
   * Un único `UPDATE` de conjunto — sin bucle por fila (a diferencia del batch
   * de `ImportRunner`, acá no hay transformación por fila que justifique
   * `await` incremental: es un `SET` con los mismos tres valores para todo el
   * conjunto). Devuelve cuántas filas tocó ESTA corrida.
   */
  async anonymizeRetentionEligible(
    cutoff: Date,
    reason: AnonymizationReason,
  ): Promise<number> {
    const { count } = await this.prisma.order.updateMany({
      where: { anonymized_at: null, created_at: { lt: cutoff } },
      data: {
        buyer_name: ANONYMIZED_BUYER_NAME,
        buyer_email: ANONYMIZED_BUYER_EMAIL,
        buyer_phone: ANONYMIZED_BUYER_PHONE,
        anonymized_at: new Date(),
        anonymization_reason: reason,
      },
    });
    return count;
  }

  /**
   * Anonimiza TODAS las órdenes no anonimizadas del cliente en un único
   * `UPDATE` de conjunto (US-020, mismo idioma que `anonymizeRetentionEligible`
   * de US-021, pero con `customer_id` en el `WHERE` en vez de un corte de
   * fecha). Guardado por `anonymized_at: null`: una segunda corrida sobre el
   * mismo cliente afecta 0 filas, sin error — es el mismo caso idempotente de
   * `anonymize()`. Acepta `tx` porque siempre corre dentro de la transacción
   * de `AccountDeletionService.deleteAccount`.
   */
  async anonymizeAllForCustomer(
    customerId: string,
    reason: AnonymizationReason,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<number> {
    const { count } = await tx.order.updateMany({
      where: { customer_id: customerId, anonymized_at: null },
      data: {
        buyer_name: ANONYMIZED_BUYER_NAME,
        buyer_email: ANONYMIZED_BUYER_EMAIL,
        buyer_phone: ANONYMIZED_BUYER_PHONE,
        anonymized_at: new Date(),
        anonymization_reason: reason,
      },
    });
    return count;
  }

  /**
   * Transición de estado condicional (US-012 AC-3, AC-6, design.md §D4):
   * `UPDATE ... WHERE id=$id AND status=$from` — si otra transición ganó la
   * carrera entre la lectura y este `UPDATE`, afecta 0 filas y devuelve
   * `null` (el caller decide si es no-op o 409, no este método). `to='delivered'`
   * también setea `delivered_at`. Requiere `tx`: siempre se llama dentro de la
   * transacción que también escribe `order_status_history` (T6.2) — nunca
   * suelto, para que ambas escrituras sean atómicas.
   */
  async updateStatusConditional(
    id: string,
    from: string,
    to: string,
    tx: Prisma.TransactionClient,
  ): Promise<Order | null> {
    const result = await tx.order.updateMany({
      where: { id, status: from },
      data: {
        status: to,
        ...(to === 'delivered' ? { delivered_at: new Date() } : {}),
      },
    });
    if (result.count === 0) return null;
    return tx.order.findUniqueOrThrow({ where: { id } });
  }

  /**
   * Transiciona `pending_payment -> new` (US-023 AC-1), guardada por
   * `WHERE status = 'pending_payment'` — devuelve `null` si la orden ya no
   * estaba en ese estado (idempotencia/concurrencia, AC-4/AC-5). No lanza:
   * `ConfirmOrderService` decide el error (`design.md` §Approach). Recibe
   * el `tx` de esa transacción — nunca corre suelta cuando confirma un pago,
   * porque tiene que revertir junto con el decremento de stock si algo falla.
   */
  async transitionToNewIfPending(
    orderId: string,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<OrderWithItems | null> {
    const { count } = await tx.order.updateMany({
      where: { id: orderId, status: 'pending_payment' },
      data: { status: 'new', confirmed_at: new Date() },
    });
    if (count === 0) return null;
    return tx.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { items: true },
    });
  }

  /**
   * Lectura simple por estado, más nuevas primero (US-023 AC-2). Fuera de
   * cualquier transacción de escritura — nunca recibe `tx`.
   */
  listByStatus(status: string): Promise<Order[]> {
    return this.prisma.order.findMany({
      where: { status },
      orderBy: { created_at: 'desc' },
    });
  }

  /**
   * Cancelación condicional (US-010 AC-4/AC-11, `design.md` §D2): mismo
   * compare-and-set que `transitionToNewIfPending` — `WHERE status =
   * 'pending_payment'`, `null` si otra transición ya ganó la carrera. Recibe
   * `tx` porque siempre corre junto con `createRefundPendingPayment` (T2.3)
   * dentro de la MISMA transacción de compensación (`design.md` §D2 — nunca
   * dentro de la transacción original, que ya revirtió).
   */
  async transitionToCancelledIfPending(
    orderId: string,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<Order | null> {
    const { count } = await tx.order.updateMany({
      where: { id: orderId, status: 'pending_payment' },
      data: { status: 'cancelled', cancelled_at: new Date() },
    });
    if (count === 0) return null;
    return tx.order.findUniqueOrThrow({ where: { id: orderId } });
  }

  /**
   * Limpieza de abandonadas (US-010 AC-11): `updateMany` en bloque por
   * antigüedad — no es condicional por fila (no hay carrera que cuidar,
   * sólo un corte de tiempo), a diferencia de las transiciones de una sola
   * orden de arriba. Nunca recibe `tx`: corre sola, fuera de cualquier otra
   * escritura.
   */
  async cancelAbandonedPending(cutoff: Date): Promise<number> {
    const { count } = await this.prisma.order.updateMany({
      where: { status: 'pending_payment', created_at: { lt: cutoff } },
      data: { status: 'cancelled', cancelled_at: new Date() },
    });
    return count;
  }

  /**
   * Cancelación manual del dueño (US-013 AC-1/AC-8): mismo compare-and-set
   * guardado que `transitionToCancelledIfPending`, esta vez sobre los 3
   * estados activos (`new`/`preparing`/`ready`) en vez de `pending_payment` —
   * `delivered` (terminal) y `cancelled` (ya cancelada) devuelven `null` sin
   * escribir nada. Incluye `items` porque el caller necesita las líneas para
   * el reintegro de stock en la misma transacción.
   */
  async transitionToCancelledIfActive(
    orderId: string,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<OrderWithItems | null> {
    const { count } = await tx.order.updateMany({
      where: { id: orderId, status: { in: ['new', 'preparing', 'ready'] } },
      data: { status: 'cancelled', cancelled_at: new Date() },
    });
    if (count === 0) return null;
    return tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true } });
  }

  private translate(error: unknown): unknown {
    if (isPrismaError(error, PRISMA_FK_VIOLATION)) {
      // Un producto de la orden dejó de existir entre la lectura del carrito y
      // la transacción (carrera con un borrado). No es un 500: el checkout
      // devuelve 0 filas y el llamador reintenta con el carrito re-validado.
      return new ValidationError('Uno de los productos del carrito ya no existe');
    }
    return error;
  }
}
