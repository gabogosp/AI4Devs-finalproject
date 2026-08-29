import { ExecutionContext, Injectable } from '@nestjs/common';
import {
  ThrottlerGuard,
  ThrottlerLimitDetail,
  ThrottlerRequest,
} from '@nestjs/throttler';

/**
 * Throttle de la superficie del carrito (§7.3) — espejo de
 * `StorefrontThrottlerGuard`: emite el contrato de cabeceras de `api-standards`
 * §12 (`RateLimit-*` y `Retry-After`).
 *
 * Las cabeceras se ponen en el `response` **antes** de lanzar, porque el filtro
 * global RFC 7807 reconstruye el cuerpo del error y si no se pierden.
 *
 * El controller lo scopea con `@SkipThrottle` de los otros throttlers nombrados
 * para que agotar el carrito no consuma el presupuesto de auth ni el del
 * storefront (y viceversa).
 */
@Injectable()
export class CartThrottlerGuard extends ThrottlerGuard {
  private static toSeconds(ms: number): number {
    return Math.max(1, Math.ceil(ms / 1000));
  }

  protected async handleRequest(
    requestProps: ThrottlerRequest,
  ): Promise<boolean> {
    const allowed = await super.handleRequest(requestProps);
    const res = requestProps.context.switchToHttp().getResponse<{
      setHeader?: (k: string, v: string | number) => void;
    }>();
    res.setHeader?.('RateLimit-Limit', requestProps.limit);
    return allowed;
  }

  protected async throwThrottlingException(
    context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    const res = context.switchToHttp().getResponse<{
      setHeader?: (k: string, v: string | number) => void;
    }>();
    const retryAfter = CartThrottlerGuard.toSeconds(
      detail.timeToBlockExpire || detail.timeToExpire || detail.ttl,
    );
    res.setHeader?.('Retry-After', retryAfter);
    res.setHeader?.('RateLimit-Limit', detail.limit);
    res.setHeader?.('RateLimit-Remaining', 0);
    res.setHeader?.('RateLimit-Reset', retryAfter);
    return super.throwThrottlingException(context, detail);
  }
}
