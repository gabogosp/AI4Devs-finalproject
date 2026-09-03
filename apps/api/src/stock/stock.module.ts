import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { StockRepository } from './stock.repository';

/**
 * Único escritor de `products.stock` (`design.md` §Approach). Sin
 * controller propio — sólo expone `StockRepository` a quien orqueste la
 * transacción de confirmación de pago (`PaymentsModule`).
 */
@Module({
  imports: [PrismaModule],
  providers: [StockRepository],
  exports: [StockRepository],
})
export class StockModule {}
