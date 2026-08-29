import { Injectable } from '@nestjs/common';
import { Order, OrderItem } from '@dsm/db';
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
