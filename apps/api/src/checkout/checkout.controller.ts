import { Body, Controller, Post, Req, Res, UseGuards } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { CartCsrfGuard } from '../cart/cart-csrf.guard';
import { CheckoutThrottlerGuard } from './checkout-throttler.guard';
import { CheckoutResponseDto } from './dto/checkout-response.dto';
import { CreateCheckoutDto } from './dto/create-checkout.dto';
import { CheckoutService } from './checkout.service';

/**
 * Presupuesto de la única escritura del checkout, leído de `process.env` (los
 * decoradores se evalúan antes del contenedor). Zod ya validó el valor al
 * arrancar (T0.2).
 */
const CHECKOUT_RATE_LIMIT_MAX = Number(
  process.env.CHECKOUT_RATE_LIMIT_MAX ?? 10,
);

/**
 * Superficie **pública** del checkout guest (US-008) — `CheckoutModule` del
 * E2E §6.1. Un solo endpoint, escritura pública que crea filas con PII.
 *
 * Controller fino (§2): ninguna regla de negocio vive acá. **Reusa
 * `CartCsrfGuard`**: la escritura se autoriza con la cookie `dsm_cart`, que es
 * credencial ambiente — a diferencia de `POST /v1/payments` (US-009), que se
 * autoriza con un token en el cuerpo y por eso no lleva este guard.
 */
@Controller('v1/checkout')
@UseGuards(CheckoutThrottlerGuard)
// Los presupuestos ajenos se saltean explícitamente — agotar el checkout no
// puede consumir el cupo de login, storefront, carrito, enrichment ni search.
@SkipThrottle({
  auth: true,
  storefront: true,
  cart: true,
  enrichment: true,
  search: true,
})
export class CheckoutController {
  constructor(private readonly checkout: CheckoutService) {}

  @Post()
  @UseGuards(CartCsrfGuard)
  @Throttle({ checkout: { limit: CHECKOUT_RATE_LIMIT_MAX } })
  async create(
    @Body() body: CreateCheckoutDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CheckoutResponseDto> {
    res.status(201);
    const orden = await this.checkout.createOrder(req, {
      buyerName: body.buyer.name,
      buyerEmail: body.buyer.email,
      buyerPhone: body.buyer.phone,
    });
    return CheckoutResponseDto.from(orden);
  }
}
