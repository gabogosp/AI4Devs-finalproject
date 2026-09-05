import {
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { AdminGuard } from '../auth/admin.guard';
import { OrdersRepository } from '../checkout/orders.repository';
import { ConfirmOrderService } from './confirm-order.service';
import { PaymentConfirmedDto } from './dto/payment-confirmed.dto';
import { PendingPaymentOrderDto } from './dto/pending-payment-order.dto';

/**
 * Superficie admin de US-023 (`design.md` §Approach "Endpoints"). Comparte
 * el prefix `v1/admin/orders` con `US-012-panel-ordenes-dueno-backend`
 * (`OrdersController`, planificado por separado) — coordinado 2026-08-30:
 * ese controller restringe su `:id` a forma UUID para que el orden de
 * registro de módulos no importe frente al literal `pending-payment` de acá.
 *
 * Sin throttler dedicado — mismo criterio que `ProductsController`:
 * superficie admin de bajo volumen, un solo operador (`design.md` §Approach).
 * `Cache-Control: no-store` lo pone el middleware global de `/v1/admin/*`
 * (`bootstrap.ts`) — no hace falta repetirlo acá.
 */
@Controller('v1/admin/orders')
@UseGuards(AdminGuard)
export class PaymentConfirmationController {
  constructor(
    private readonly confirmOrder: ConfirmOrderService,
    private readonly orders: OrdersRepository,
    private readonly jwt: JwtService,
  ) {}

  @Post(':orderId/confirm-payment')
  @HttpCode(200)
  async confirmPayment(
    @Param('orderId', new ParseUUIDPipe()) orderId: string,
    @Req() req: Request,
  ): Promise<PaymentConfirmedDto> {
    const confirmado = await this.confirmOrder.confirm({
      orderId,
      provider: 'manual',
      confirmedBy: this.confirmedByFrom(req),
    });
    return PaymentConfirmedDto.from(confirmado);
  }

  @Get('pending-payment')
  async listPendingPayment(): Promise<PendingPaymentOrderDto[]> {
    const ordenes = await this.orders.listByStatus('pending_payment');
    return ordenes.map(PendingPaymentOrderDto.from);
  }

  /**
   * Decodifica (NO re-verifica — `AdminGuard` ya lo hizo) el mismo bearer
   * token para leer el claim `sub`. No toca `auth/admin.guard.ts`: US-014
   * lo tiene congelado (`design.md` §Approach "Identidad del que confirma").
   */
  private confirmedByFrom(req: Request): string {
    const header = req.headers.authorization;
    const token =
      typeof header === 'string' && header.startsWith('Bearer ')
        ? header.slice('Bearer '.length).trim()
        : '';
    const payload = this.jwt.decode(token) as { sub?: string } | null;
    return payload?.sub ?? 'admin';
  }
}
