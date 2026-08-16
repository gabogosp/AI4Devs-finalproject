import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

/** Header de caché acotada de la ficha pública (US-003 AC-9, OQ-BE-2). */
export const STOREFRONT_CACHE_CONTROL =
  'public, max-age=60, stale-while-revalidate=30';

/**
 * Estampa `Cache-Control` acotado **sólo en respuestas exitosas** (AC-9). El
 * `tap` corre cuando el handler emite (2xx); ante una excepción (404 del service,
 * 429 del throttler) el observable falla y el `tap` NO se ejecuta, así que el
 * error viaja SIN header cacheable.
 *
 * Fix del hallazgo M1 del audit: el middleware de borde estampaba el header en
 * TODA respuesta `/v1/products/*` (incluidos 404/429), lo que permitiría a un CDN
 * compartido (keyed por URL) cachear un error y convertir la mitigación de DoS en
 * un vector. Acotarlo a 2xx elimina ese riesgo.
 */
@Injectable()
export class StorefrontCacheInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      tap(() => {
        const res = context.switchToHttp().getResponse<{
          setHeader?: (k: string, v: string) => void;
        }>();
        res.setHeader?.('Cache-Control', STOREFRONT_CACHE_CONTROL);
      }),
    );
  }
}
