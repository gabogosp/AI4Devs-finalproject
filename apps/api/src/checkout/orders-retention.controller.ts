import {
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { AdminGuard } from '../auth/admin.guard';
import { AuthThrottlerGuard } from '../auth/auth-throttler.guard';
import {
  OrderAnonymizationResultDto,
  RetentionSweepResultDto,
} from './dto/orders-retention.dto';
import { OrdersRetentionService } from './orders-retention.service';

/**
 * Presupuestos de rate-limit (§7.3). Se leen de `process.env` porque los
 * decoradores se evalúan al cargar la clase, antes del contenedor — igual que
 * `imports.controller.ts`. Zod ya validó los valores al arrancar.
 */
const ANONYMIZE_RATE_LIMIT_MAX = Number(
  process.env.ORDER_ANONYMIZE_RATE_LIMIT_MAX ?? 30,
);
const ANONYMIZE_RATE_LIMIT_TTL_MS = Number(
  process.env.ORDER_ANONYMIZE_RATE_LIMIT_TTL_MS ?? 60_000,
);
const SWEEP_RATE_LIMIT_MAX = Number(
  process.env.ORDER_RETENTION_SWEEP_RATE_LIMIT_MAX ?? 5,
);
const SWEEP_RATE_LIMIT_TTL_MS = Number(
  process.env.ORDER_RETENTION_SWEEP_RATE_LIMIT_TTL_MS ?? 3_600_000,
);

/**
 * Superficie admin de retención/anonimización de órdenes (US-021).
 * Gateada por `AdminGuard` (ADR-0009, AC-9) — sin modificar, mismo seam que
 * categorías/productos/imports.
 */
@Controller('v1/admin/orders')
@UseGuards(AdminGuard, AuthThrottlerGuard)
@SkipThrottle({ storefront: true, cart: true })
export class OrdersRetentionController {
  constructor(private readonly retention: OrdersRetentionService) {}

  /** Anonimización a pedido del comprador (AC-3, AC-9). */
  @Post(':id/anonymize')
  @HttpCode(200)
  @Throttle({
    auth: { limit: ANONYMIZE_RATE_LIMIT_MAX, ttl: ANONYMIZE_RATE_LIMIT_TTL_MS },
  })
  async anonymizeOne(
    @Param(
      'id',
      new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY }),
    )
    id: string,
  ): Promise<OrderAnonymizationResultDto> {
    const result = await this.retention.anonymizeOnRequest(id);
    return OrderAnonymizationResultDto.from(id, result);
  }

  /** Barrido manual por plazo cumplido (AC-1). */
  @Post('retention-sweep')
  @HttpCode(200)
  @Throttle({
    auth: { limit: SWEEP_RATE_LIMIT_MAX, ttl: SWEEP_RATE_LIMIT_TTL_MS },
  })
  async sweep(): Promise<RetentionSweepResultDto> {
    const count = await this.retention.runRetentionSweep();
    return RetentionSweepResultDto.from(count);
  }
}
