import { timingSafeEqual } from 'node:crypto';
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { CsrfError } from '../common/errors/auth-errors';
import { verifyRequestOrigin } from '../common/http/origin';
import { parseCorsOrigins } from '../config/env.validation';
import { CART_COOKIE, deriveCsrfToken } from '../auth/cookies';
import { CSRF_HEADER } from '../auth/csrf.guard';

/**
 * Anti-CSRF de la superficie del carrito — `security-standards.md` §7.5.
 *
 * Espejo de `CsrfGuard`, con una diferencia que obliga a que sea otro guard: el
 * invitado **no tiene `jti`**. La sesión de US-014 deriva el double-submit del
 * `jti` del access; el carrito lo deriva del token opaco de `dsm_cart`. Mismo
 * mecanismo (HMAC con `JWT_SECRET`, recalculable, imposible de forjar sin el
 * secreto), otro sujeto.
 *
 * `SameSite=Lax` es la primera capa; ésta es la segunda, porque §7.5 pide dos
 * cuando la autenticación viaja en cookies — y acá la cookie **es** la identidad
 * del carrito.
 *
 * **Primera escritura sin cookie de carrito**: pasa. No es una excepción cómoda,
 * es que no hay nada que proteger — sin cookie no hay carrito que secuestrar, no
 * hay double-submit posible (el valor esperado se deriva del token que no existe)
 * y lo peor que logra un tercero es que la víctima estrene un carrito vacío.
 * Exigir CSRF ahí no protegería nada y rompería el primer «agregar al carrito» de
 * todo cliente nuevo.
 *
 * Sólo se aplica a las escrituras. El `GET /v1/cart` no lo exige: es seguro, no
 * tiene efectos y CSRF protege efectos.
 */
@Injectable()
export class CartCsrfGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();

    const token = (req as Request & { cookies?: Record<string, string> })
      .cookies?.[CART_COOKIE];

    // Sin cookie de carrito no hay sesión de carrito que defender (ver arriba).
    if (typeof token !== 'string' || token.length === 0) return true;

    verifyRequestOrigin(
      req,
      parseCorsOrigins(this.config.get<string>('CORS_ALLOWED_ORIGINS') ?? ''),
    );

    const presentado = req.headers[CSRF_HEADER];
    if (typeof presentado !== 'string' || presentado.length === 0) {
      throw new CsrfError();
    }

    const esperado = deriveCsrfToken(
      token,
      this.config.getOrThrow<string>('JWT_SECRET'),
    );

    // Comparación en tiempo constante: un `===` filtra por timing cuántos
    // caracteres coincidieron, y con suficientes intentos eso permite construir
    // el valor carácter por carácter.
    const a = Buffer.from(presentado, 'utf8');
    const b = Buffer.from(esperado, 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new CsrfError();
    }

    return true;
  }
}
