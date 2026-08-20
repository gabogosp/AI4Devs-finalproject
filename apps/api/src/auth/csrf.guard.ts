import { timingSafeEqual } from 'node:crypto';
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { CsrfError } from '../common/errors/auth-errors';
import { parseCorsOrigins } from '../config/env.validation';
import { ACCESS_COOKIE, deriveCsrfToken } from './cookies';

export const CSRF_HEADER = 'x-csrf-token';

/**
 * Segunda capa anti-CSRF — `security-standards.md` §7.5.
 *
 * `SameSite=Lax` es la primera capa y cubre la mayoría de los casos, pero no
 * todos: no protege de un subdominio comprometido, y hay navegadores viejos que
 * lo ignoran. §7.5 pide dos capas, y éstas son:
 *
 * 1. **Double-submit firmado**: el valor del header tiene que ser el HMAC del
 *    `jti` del token presentado. Un atacante en otro origen puede hacer que el
 *    navegador mande las cookies, pero la política de mismo origen le impide
 *    **leer** la cookie CSRF para copiarla al header.
 * 2. **`Origin` en la allowlist**. Y su ausencia también se rechaza: una
 *    escritura autenticada por cookie que no declara origen no es verificable, y
 *    lo no verificable se rechaza (§3.8, fail closed).
 *
 * Sólo se aplica a las rutas **autenticadas por cookie**. `login`, `register` y
 * los de reset no lo exigen: ahí todavía no hay sesión que secuestrar, y pedirlo
 * rompería a cualquier cliente que no sea el navegador.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();

    this.verificarOrigen(req);
    await this.verificarDoubleSubmit(req);

    return true;
  }

  private verificarOrigen(req: Request): void {
    const permitidos = parseCorsOrigins(
      this.config.get<string>('CORS_ALLOWED_ORIGINS') ?? '',
    );

    const origin = req.headers.origin;
    if (typeof origin === 'string' && origin.length > 0) {
      // Igualdad exacta, igual que CORS: nada de sufijos ni regex, porque
      // `https://dsm.com.ar.evil.net` termina en el dominio bueno.
      if (!permitidos.includes(origin)) throw new CsrfError();
      return;
    }

    // Sin `Origin`, se acepta `Referer` como respaldo — algunos navegadores no
    // mandan Origin en ciertos flujos. Se compara sólo el origen del Referer,
    // no la ruta.
    const referer = req.headers.referer;
    if (typeof referer === 'string' && referer.length > 0) {
      try {
        const { origin: origenDelReferer } = new URL(referer);
        if (!permitidos.includes(origenDelReferer)) throw new CsrfError();
        return;
      } catch (error) {
        // Un Referer que no parsea no es evidencia de nada.
        if (error instanceof CsrfError) throw error;
        throw new CsrfError();
      }
    }

    // Ninguno de los dos: no verificable ⇒ rechazo (§7.5).
    throw new CsrfError();
  }

  private async verificarDoubleSubmit(req: Request): Promise<void> {
    const presentado = req.headers[CSRF_HEADER];
    if (typeof presentado !== 'string' || presentado.length === 0) {
      throw new CsrfError();
    }

    const access = (req as Request & { cookies?: Record<string, string> })
      .cookies?.[ACCESS_COOKIE];
    if (typeof access !== 'string' || access.length === 0) {
      throw new CsrfError();
    }

    const secret = this.config.getOrThrow<string>('JWT_SECRET');

    let jti: unknown;
    try {
      // `decode` y no `verify`: la validez del token ya la comprobó el
      // `CustomerGuard`, que corre antes. Acá sólo hace falta el `jti` para
      // derivar el valor esperado — y si el token no fuera válido, el otro guard
      // ya habría rechazado.
      jti = this.jwt.decode<Record<string, unknown>>(access)?.jti;
    } catch {
      throw new CsrfError();
    }

    if (typeof jti !== 'string') throw new CsrfError();

    const esperado = deriveCsrfToken(jti, secret);

    // Comparación en tiempo constante: un `===` filtra por timing cuántos
    // caracteres coincidieron, y con suficientes intentos eso permite construir
    // el valor carácter por carácter.
    const a = Buffer.from(presentado, 'utf8');
    const b = Buffer.from(esperado, 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new CsrfError();
    }
  }
}
