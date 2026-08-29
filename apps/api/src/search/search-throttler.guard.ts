import { ExecutionContext, Inject, Injectable, Optional } from '@nestjs/common';
import {
  ThrottlerGuard,
  ThrottlerLimitDetail,
  ThrottlerRequest,
} from '@nestjs/throttler';
import { SearchEventsService } from '../observability/search-events.service';

/**
 * Throttle de `/v1/search` (US-004 AC-10) — espejo de `StorefrontThrottlerGuard`.
 *
 * Emite `RateLimit-*` y `Retry-After` **antes** de lanzar, porque el filtro global RFC 7807
 * reconstruye el cuerpo del error y si las cabeceras no están puestas en el `response` se
 * pierden (api-standards §12).
 *
 * Por qué su presupuesto es más estricto que el del storefront (20/min contra 60/min): navegar
 * el catálogo cuesta CPU y una query; buscar puede costar **una llamada paga a un tercero**. Es
 * la única superficie **pública** del sistema donde un request de más se traduce en dinero, y
 * el caché de vectores no cubre el caso que importa —consultas distintas—, que es justamente el
 * que un abusador generaría.
 */
@Injectable()
export class SearchThrottlerGuard extends ThrottlerGuard {
  /**
   * El evento `rate_limited` se emite acá porque el guard es **el único** que sabe del 429: el
   * handler nunca corre. Ponerlo en el service dejaría el evento sin emitir justo en el caso
   * que interesa medir — el de abuso.
   *
   * `@Optional()` + `@Inject` explícito: `ThrottlerGuard` tiene su propio constructor con tres
   * dependencias posicionales, así que la propia se agrega al final y sin romper las suyas.
   */
  @Optional()
  @Inject(SearchEventsService)
  private readonly events?: SearchEventsService;

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
    const retryAfter = SearchThrottlerGuard.toSeconds(
      detail.timeToBlockExpire || detail.timeToExpire || detail.ttl,
    );
    res.setHeader?.('Retry-After', retryAfter);
    res.setHeader?.('RateLimit-Limit', detail.limit);
    res.setHeader?.('RateLimit-Remaining', 0);
    res.setHeader?.('RateLimit-Reset', retryAfter);
    // `no-store` en el 429: un rate-limit cacheado en el edge se convierte en un DoS —la misma
    // lección que el runbook ya tiene anotada para el carrito.
    res.setHeader?.('Cache-Control', 'no-store');

    // Sin `query`: en un 429 no hay búsqueda que registrar, y el texto de quien está abusando
    // no aporta nada que el conteo por IP del throttler no diga mejor.
    this.events?.emit('search.rate_limited');

    return super.throwThrottlingException(context, detail);
  }
}
