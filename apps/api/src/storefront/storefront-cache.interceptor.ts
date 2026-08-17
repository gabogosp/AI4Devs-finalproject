import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

/** Header de caché acotada de la ficha pública (US-003 AC-9, OQ-BE-2). */
export const STOREFRONT_CACHE_CONTROL =
  'public, max-age=60, stale-while-revalidate=30';

export const STOREFRONT_CACHE_KEY = 'storefront-cache';

export interface StorefrontCacheOptions {
  maxAge: number;
  swr: number;
}

/** Default del storefront: frescura acotada del precio (US-003 AC-9). */
export const STOREFRONT_CACHE_DEFAULT: StorefrontCacheOptions = {
  maxAge: 60,
  swr: 30,
};

/**
 * TTL por endpoint (US-002 D5). Se declara en la ruta, no en el interceptor,
 * para que el que lee el handler vea su política de caché al lado.
 */
export const StorefrontCache = (opts: StorefrontCacheOptions) =>
  SetMetadata(STOREFRONT_CACHE_KEY, opts);

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
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    // El handler puede pedir su propio TTL (@StorefrontCache); si no, rige el
    // default del storefront.
    const opts =
      this.reflector.get<StorefrontCacheOptions | undefined>(
        STOREFRONT_CACHE_KEY,
        context.getHandler(),
      ) ?? STOREFRONT_CACHE_DEFAULT;
    const value = `public, max-age=${opts.maxAge}, stale-while-revalidate=${opts.swr}`;
    return next.handle().pipe(
      tap(() => {
        const res = context.switchToHttp().getResponse<{
          setHeader?: (k: string, v: string) => void;
        }>();
        res.setHeader?.('Cache-Control', value);
      }),
    );
  }
}
