import { HttpStatus, INestApplication, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { HttpProblemFilter } from './common/filters/http-problem.filter';
import { parseCorsOrigins } from './config/env.validation';

/**
 * Configuración compartida por `main.ts` y los tests e2e-nest: security headers
 * (§7.1), CORS con allowlist explícita (§7.2), ValidationPipe global (whitelist)
 * y filtro RFC 7807. Mantiene un único punto de verdad para el borde HTTP.
 */
export function configureApp(app: INestApplication): void {
  // T4.2 — las cookies de sesión (US-014) llegan como header crudo; sin este
  // parser `req.cookies` no existe y los guards leerían `undefined` en vez de
  // rechazar. Va en el borde, junto al resto, no en el módulo de auth: si un
  // test e2e levantara la app sin él, los guards fallarían abierto.
  app.use(cookieParser());

  // §7.3 — sin esto el rate-limit por IP no distingue clientes detrás de un
  // proxy. El valor es configurable y su default es 0 a propósito: ver la nota
  // de `TRUST_PROXY_HOPS` en env.validation.
  const hops = Number(process.env.TRUST_PROXY_HOPS ?? 0);
  if (hops > 0) {
    app.getHttpAdapter().getInstance().set('trust proxy', hops);
  }

  // §7.1 — perfil API-only: nosniff + HSTS + Referrer-Policy + X-Frame-Options
  // + CSP mínima para JSON renderizado por un browser. Se setea UNA vez en el
  // borde, nunca por handler.
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          'default-src': ["'none'"],
          'frame-ancestors': ["'none'"],
          'base-uri': ["'self'"],
        },
      },
      hsts: { maxAge: 31_536_000, includeSubDomains: true },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      frameguard: { action: 'deny' },
    }),
  );

  // §7.1 — las respuestas autenticadas de `/v1/admin` y **toda** la superficie del
  // carrito (`/v1/cart`, US-007) NO se cachean, incluidos sus errores. Seteo único
  // en el borde.
  //
  // Va en el middleware y NO en un interceptor a propósito: el interceptor sólo
  // corre en 2xx, y acá el header tiene que cubrir también los 4xx/429. Un 429 del
  // carrito cacheado en el edge convierte el rate-limit en un DoS, y un carrito
  // cacheado se le serviría a otro cliente. AC-9 también depende de esto: sin
  // `no-store`, una caché intermedia puede devolver precios viejos aunque el
  // cálculo del servidor sea perfecto.
  //
  // La caché ACOTADA de la ficha pública `/v1/products` (AC-9 de US-003) NO se
  // setea acá: este middleware corre ANTES del routing y no ve el status, así que
  // estampaba el header también en 404/429 (hallazgo M1 del audit — un CDN
  // compartido podría cachear un error). Se mueve a `StorefrontCacheInterceptor`,
  // que sólo corre en respuestas 2xx del controller público.
  app.use((req: { path?: string; url?: string }, res: { setHeader: (k: string, v: string) => void }, next: () => void) => {
    const path = req.path ?? req.url ?? '';
    if (path.startsWith('/v1/admin') || path.startsWith('/v1/cart')) {
      res.setHeader('Cache-Control', 'no-store');
    }
    next();
  });

  // §7.2 — allowlist EXACTA por entorno. Sin `*`, sin regex ni sufijos: un
  // origen fuera de la lista simplemente no recibe Access-Control-Allow-Origin.
  const allowed = parseCorsOrigins(process.env.CORS_ALLOWED_ORIGINS ?? '');
  app.enableCors({
    origin: (origin, callback) => {
      // Sin header Origin (curl, server-to-server) no es una petición CORS.
      if (!origin) return callback(null, true);
      callback(null, allowed.includes(origin));
    },
    credentials: true,
    // `PUT` y `DELETE` los agrega US-007 (T4.4): sin ellos el preflight de las
    // escrituras del carrito falla en el navegador y la superficie es
    // inalcanzable desde el FE, aunque el servidor la sirva perfecto por curl.
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    // `X-CSRF-Token` (T5.3): sin declararlo, el preflight del panel falla y el
    // logout/refresh se vuelven inalcanzables desde el browser.
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'traceparent',
      'X-CSRF-Token',
    ],
    exposedHeaders: ['RateLimit-Limit', 'RateLimit-Remaining', 'RateLimit-Reset', 'Retry-After'],
    maxAge: 86_400, // ≤ 24 h
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      // AC-5: violación de validación → 422 (no 400) con errors[] por campo.
      errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
    }),
  );
  app.useGlobalFilters(new HttpProblemFilter());
}
