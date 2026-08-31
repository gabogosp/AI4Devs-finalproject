import { Injectable } from '@nestjs/common';
import { Order, OrderItem, Prisma } from '@dsm/db';
import { PrismaService } from '../prisma/prisma.service';
import { ValidationError } from '../common/errors/domain-errors';
import { isPrismaError, PRISMA_FK_VIOLATION } from '../common/prisma-errors';

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
   * Detalle admin (US-012 AC-2). Devuelve la orden para CUALQUIER `status`
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
