import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Put,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { CartService } from './cart.service';
import { CartCsrfGuard } from './cart-csrf.guard';
import { CartThrottlerGuard } from './cart-throttler.guard';
import { CartDto } from './dto/cart.dto';
import { SetCartItemDto } from './dto/set-cart-item.dto';

/**
 * Presupuesto de **escritura** (§7.3): más estricto que el de lectura, porque cada
 * request crea o modifica filas. Se lee de `process.env` porque los decoradores se
 * evalúan al definir la clase, antes de que exista el contenedor de DI; el valor es
 * el mismo que `envSchema` ya validó al arrancar.
 */
const LIMITE_DE_ESCRITURA = Number(
  process.env.CART_WRITE_RATE_LIMIT_MAX ?? 30,
);

/**
 * Superficie **pública** del carrito del invitado (US-007) — la primera de
 * `@dsm/api` que **escribe** sin autenticación. Sin `AdminGuard` ni
 * `CustomerGuard`: el guest checkout es el camino principal del PRD (§2.1 cap. 4).
 *
 * El controller es fino (§2): valida por DTO, delega y mapea. Ninguna regla de
 * negocio vive acá — ni cálculo de precio, ni comparación de stock, ni decisión de
 * disponibilidad.
 *
 * El producto se identifica por **`slug`**: es el identificador público que
 * establecieron US-002/US-003, cuyos DTO deliberadamente no exponen `id`. Y el
 * carrito **no** aparece en la URL: la identidad es la cookie, así que la
 * superficie es estructuralmente inmune a IDOR en vez de depender de un chequeo de
 * propiedad que alguien pueda olvidar.
 *
 * Las tres respuestas devuelven el carrito **completo** para que el cliente nunca
 * tenga que adivinar el estado ni encadenar un `GET` (es lo que hace usable la
 * semántica absoluta del `PUT`).
 */
@Controller('v1/cart')
// §7.3 — presupuesto propio por IP. El `@SkipThrottle` cruzado evita que el
// carrito consuma el presupuesto de auth o del storefront.
@UseGuards(CartThrottlerGuard)
@SkipThrottle({ auth: true, storefront: true })
export class CartController {
  constructor(private readonly cart: CartService) {}

  /**
   * Lee el carrito (AC-4, AC-6, AC-7, AC-9). **No** exige CSRF: es una operación
   * segura y CSRF protege efectos. Tampoco crea carrito ni emite cookie.
   */
  @Get()
  async get(@Req() req: Request): Promise<{ cart: CartDto }> {
    return { cart: CartDto.from(await this.cart.getCart(req)) };
  }

  /**
   * Fija la cantidad **absoluta** de un producto (AC-1, AC-2).
   *
   * `PUT` y no `POST` de suma relativa: así es naturalmente idempotente
   * (`api-standards.md` §10.5) y un reintento de red nunca compra de más, sin
   * necesidad de `Idempotency-Key` ni su almacén (OQ-BE-5).
   */
  @Put('items/:slug')
  @UseGuards(CartCsrfGuard)
  @Throttle({ cart: { limit: LIMITE_DE_ESCRITURA } })
  async setItem(
    @Param('slug') slug: string,
    @Body() body: SetCartItemDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ cart: CartDto }> {
    const view = await this.cart.setItem(req, res, slug, body.quantity);
    return { cart: CartDto.from(view) };
  }

  /** Quita la línea (AC-3). Idempotente: quitar lo que no está devuelve 200. */
  @Delete('items/:slug')
  @UseGuards(CartCsrfGuard)
  @Throttle({ cart: { limit: LIMITE_DE_ESCRITURA } })
  async removeItem(
    @Param('slug') slug: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ cart: CartDto }> {
    const view = await this.cart.removeItem(req, res, slug);
    return { cart: CartDto.from(view) };
  }
}
