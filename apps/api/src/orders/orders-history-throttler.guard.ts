import { ExecutionContext, Injectable } from '@nestjs/common';
import {
  ThrottlerGuard,
  ThrottlerLimitDetail,
  ThrottlerRequest,
} from '@nestjs/throttler';

/**
 * Throttle del historial de compras (US-015, design.md §D5) — espejo de
 * `CheckoutThrottlerGuard`: emite el contrato de cabeceras de
 * `api-standards` §12 (`RateLimit-*` y `Retry-After`) **antes** de lanzar,
 * porque el filtro global RFC 7807 reconstruye el cuerpo del error y si no
 * se pierden.
 *
 * El `@SkipThrottle` cruzado en el controller evita que agotar el historial
 * consuma el presupuesto de auth, storefront, carrito, enrichment, search,
 * checkout o el medio simulado de pagos — y viceversa.
 */
@Injectable()
export class OrdersHistoryThrottlerGuard extends ThrottlerGuard {
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
    const retryAfter = OrdersHistoryThrottlerGuard.toSeconds(
      detail.timeToBlockExpire || detail.timeToExpire || detail.ttl,
    );
    res.setHeader?.('Retry-After', retryAfter);
    res.setHeader?.('RateLimit-Limit', detail.limit);
    res.setHeader?.('RateLimit-Remaining', 0);
    res.setHeader?.('RateLimit-Reset', retryAfter);
    return super.throwThrottlingException(context, detail);
  }
}
