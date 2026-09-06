import { Controller, HttpCode, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { AdminGuard } from '../auth/admin.guard';
import { CancelOrderService } from './cancel-order.service';
import { CancelOrderResponseDto } from './dto/cancel-order-response.dto';

/**
 * `POST /v1/admin/orders/{id}/cancel` (US-013, `design.md` §D1/§D5). Calcado
 * a `PaymentConfirmationController` — mismo `@Controller` prefix compartido
 * con `OrdersController` (US-012) y `PaymentConfirmationController` (US-023),
 * `AdminGuard` reusado, `JwtService.decode` sin re-verificar. Sin `body`:
 * todo sale de la orden y del pago encontrados server-side, y `changedBy`
 * sale del JWT admin — nunca de un campo que el cliente pudiera falsificar
 * (mismo criterio que `confirmedByFrom`).
 *
 * Sin restricción de forma UUID en `:id` a nivel de ruta más allá de
 * `ParseUUIDPipe` — 3 segmentos + método POST no colisiona con ningún shape
 * existente (`design.md` §D1, "Colisión de rutas").
 */
@Controller('v1/admin/orders')
@UseGuards(AdminGuard)
export class OrderCancellationController {
  constructor(
    private readonly cancelOrder: CancelOrderService,
    private readonly jwt: JwtService,
  ) {}

  @Post(':id/cancel')
  @HttpCode(200)
  async cancel(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: Request,
  ): Promise<ReturnType<typeof CancelOrderResponseDto.from>> {
    const changedBy = this.changedByFrom(req);
    const resultado = await this.cancelOrder.cancel(id, changedBy);
    return CancelOrderResponseDto.from(resultado.order, resultado.history, resultado.refund);
  }

  /**
   * Decodifica (NO re-verifica — `AdminGuard` ya lo hizo) el mismo bearer
   * token para leer el claim `sub` — idéntico a
   * `PaymentConfirmationController.confirmedByFrom`. `auth/admin.guard.ts`
   * sigue congelado, no se toca.
   */
  private changedByFrom(req: Request): string {
    const header = req.headers.authorization;
    const token =
      typeof header === 'string' && header.startsWith('Bearer ')
        ? header.slice('Bearer '.length).trim()
        : '';
    const payload = this.jwt.decode(token) as { sub?: string } | null;
    return payload?.sub ?? 'admin';
  }
}
