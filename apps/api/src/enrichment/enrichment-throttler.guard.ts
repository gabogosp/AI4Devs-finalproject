import { ExecutionContext, Injectable } from '@nestjs/common';
import {
  ThrottlerGuard,
  ThrottlerLimitDetail,
  ThrottlerRequest,
} from '@nestjs/throttler';

/**
 * Throttle de la superficie que **gasta dinero** (§7.3): disparar corridas de
 * enriquecimiento cuesta llamadas pagas al proveedor de IA.
 *
 * Mirror de `StorefrontThrottlerGuard`/`AuthThrottlerGuard`: emite el contrato de cabeceras
 * de `api-standards` §12 (`RateLimit-*` y `Retry-After`), y las escribe en el `response`
 * **antes** de lanzar, porque el filtro global RFC 7807 reconstruye el body del error y si no
 * se pierden.
 *
 * Por qué un throttler propio y no el de `auth`: el presupuesto de `auth` es de login (5 por
 * 15 min) y compartirlo haría que unas cuantas corridas dejen al dueño sin poder entrar al
 * panel. Son dos recursos distintos con dos riesgos distintos.
 */
@Injectable()
export class EnrichmentThrottlerGuard extends ThrottlerGuard {
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
    const retryAfter = EnrichmentThrottlerGuard.toSeconds(
      detail.timeToBlockExpire || detail.timeToExpire || detail.ttl,
    );
    res.setHeader?.('Retry-After', retryAfter);
    res.setHeader?.('RateLimit-Limit', detail.limit);
    res.setHeader?.('RateLimit-Remaining', 0);
    res.setHeader?.('RateLimit-Reset', retryAfter);
    return super.throwThrottlingException(context, detail);
  }
}
