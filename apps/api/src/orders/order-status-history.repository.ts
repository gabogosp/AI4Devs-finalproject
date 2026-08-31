import { Injectable } from '@nestjs/common';
import { OrderStatusHistory, Prisma } from '@dsm/db';
import { PrismaService } from '../prisma/prisma.service';

export interface InsertStatusHistoryData {
  orderId: string;
  fromStatus: string | null;
  toStatus: string;
  changedBy: string | null;
}

/**
 * Único punto de ORM para `order_status_history` (§D1) — ningún otro archivo
 * toca `prisma.orderStatusHistory` directo. `insert` acepta `tx` opcional
 * (default `this.prisma`) para escribir dentro de la misma transacción que
 * `updateStatusConditional` (T6.2, design.md §D4) — mismo patrón
 * cross-repositorio que introdujo `ConfirmOrderService`/`StockRepository`/
 * `PaymentsRepository` de US-023.
 */
@Injectable()
export class OrderStatusHistoryRepository {
  constructor(private readonly prisma: PrismaService) {}

  insert(
    data: InsertStatusHistoryData,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<void> {
    return tx.orderStatusHistory
      .create({
        data: {
          order_id: data.orderId,
          from_status: data.fromStatus,
          to_status: data.toStatus,
          changed_by: data.changedBy,
        },
      })
      .then(() => undefined);
  }

  listByOrderId(orderId: string): Promise<OrderStatusHistory[]> {
    return this.prisma.orderStatusHistory.findMany({
      where: { order_id: orderId },
      orderBy: { changed_at: 'asc' },
    });
  }
}
