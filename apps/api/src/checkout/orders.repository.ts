import { Injectable } from '@nestjs/common';
import { Order, OrderItem, Prisma } from '@dsm/db';
import { PrismaService } from '../prisma/prisma.service';
import { ValidationError } from '../common/errors/domain-errors';
import { isPrismaError, PRISMA_FK_VIOLATION } from '../common/prisma-errors';

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
      data: { status: 'new' },
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
