import { ExecutionContext, Injectable } from '@nestjs/common';
import {
  ThrottlerGuard,
  ThrottlerLimitDetail,
  ThrottlerRequest,
} from '@nestjs/throttler';

/**
 * Throttle de la superficie pública del storefront (§7.3), mirror de
 * `AuthThrottlerGuard`: emite el contrato de cabeceras de `api-standards` §12
 * (`RateLimit-*` y `Retry-After`). Se necesita ponerlas en el `response` **antes**
 * de lanzar, porque el filtro global RFC 7807 reconstruye el body del error y
 * si no se pierden.
 *
 * El controller lo scopea con `@SkipThrottle({ auth: true })` para que sólo
 * cuente el throttler `storefront` (y no el `auth`, mucho más estricto).
 */
@Injectable()
export class StorefrontThrottlerGuard extends ThrottlerGuard {
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
    const retryAfter = StorefrontThrottlerGuard.toSeconds(
      detail.timeToBlockExpire || detail.timeToExpire || detail.ttl,
    );
    res.setHeader?.('Retry-After', retryAfter);
    res.setHeader?.('RateLimit-Limit', detail.limit);
    res.setHeader?.('RateLimit-Remaining', 0);
    res.setHeader?.('RateLimit-Reset', retryAfter);
    return super.throwThrottlingException(context, detail);
  }
}
