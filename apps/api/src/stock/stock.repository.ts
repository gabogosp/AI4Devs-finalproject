import { Injectable } from '@nestjs/common';
import { Prisma } from '@dsm/db';
import { PrismaService } from '../prisma/prisma.service';
import { InsufficientStockError } from './stock-errors';

export interface StockDecrementLine {
  productId: string;
  quantity: number;
}

/**
 * Único punto de ORM que escribe `products.stock` (§5) — primer escritor en
 * todo el repo. `checkout/ac6-stock-untouched.spec.ts` prohíbe esta escritura
 * desde `checkout/`; por eso vive acá, no en `ProductsRepository` ni en
 * `OrdersRepository` (`design.md` §Approach).
 *
 * `decrementForOrder` corta al primer ítem sin stock suficiente: no sigue
 * decrementando las líneas restantes, y como recibe el `tx` de
 * `ConfirmOrderService`, las líneas YA decrementadas antes del corte también
 * revierten cuando la transacción entera hace rollback (ADR-0008 — nunca
 * stock negativo, nunca un decremento parcial).
 */
@Injectable()
export class StockRepository {
  constructor(private readonly prisma: PrismaService) {}

  async decrementForOrder(
    lines: StockDecrementLine[],
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<void> {
    for (const linea of lines) {
      const { count } = await tx.product.updateMany({
        where: { id: linea.productId, stock: { gte: linea.quantity } },
        data: { stock: { decrement: linea.quantity } },
      });
      if (count === 0) {
        throw new InsufficientStockError(linea.productId);
      }
    }
  }
}
