import { ExecutionContext, Injectable } from '@nestjs/common';
import {
  ThrottlerGuard,
  ThrottlerLimitDetail,
  ThrottlerRequest,
} from '@nestjs/throttler';

/**
 * Throttle del borrado de cuenta (US-020, §7.3) — copia deliberada de
 * `AuthThrottlerGuard`/`OrdersHistoryThrottlerGuard`, no una guard
 * compartida: cada superficie tiene su propio guard porque el filtro global
 * RFC 7807 reconstruye el cuerpo del error, y las cabeceras `RateLimit-*`/
 * `Retry-After` hay que ponerlas en el `response` **antes** de lanzar, si no
 * se pierden. Compartir una guard entre superficies acoplaría su throttler
 * nombrado (`account_deletion`) a los demás sin ganar nada — es el mismo
 * boilerplate ya duplicado 2 veces en el repo.
 */
@Injectable()
export class AccountThrottlerGuard extends ThrottlerGuard {
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
    const retryAfter = AccountThrottlerGuard.toSeconds(
      detail.timeToBlockExpire || detail.timeToExpire || detail.ttl,
    );
    res.setHeader?.('Retry-After', retryAfter);
    res.setHeader?.('RateLimit-Limit', detail.limit);
    res.setHeader?.('RateLimit-Remaining', 0);
    res.setHeader?.('RateLimit-Reset', retryAfter);
    return super.throwThrottlingException(context, detail);
  }
}
