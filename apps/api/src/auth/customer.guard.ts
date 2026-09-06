import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { UnauthenticatedError } from '../common/errors/auth-errors';
import { resolveCustomerSession } from './resolve-customer-session';

/** Lo que el guard deja en el request para los handlers. */
export interface RequestConCliente extends Request {
  customerId?: string;
  accessJti?: string;
}

/**
 * Guard de sesión de cliente — `security-standards.md` §3.3 y §3.8.
 *
 * Lee el access **de la cookie**, no del header `Authorization`. Es deliberado:
 * si aceptara el header, un XSS podría usar el token que robó, y toda la
 * protección de `httpOnly` se evaporaría. La cookie sólo la manda el navegador.
 *
 * La regla que gobierna cada rama de acá es **fail closed** (§3.8): cualquier
 * cosa que no sea un token verificado con todo en orden termina en 401. La
 * verificación en sí vive en `resolveCustomerSession()` (US-015, Extract
 * Method) — este guard sólo decide qué hacer con el resultado: `null` es
 * siempre 401, sesión resuelta siempre deja pasar. `OptionalCustomerGuard`
 * (US-015) es la única otra pieza que llama al mismo helper, y decide distinto.
 */
@Injectable()
export class CustomerGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RequestConCliente>();
    const session = await resolveCustomerSession(req, this.jwt, this.config);

    if (!session) {
      throw new UnauthenticatedError();
    }

    req.customerId = session.customerId;
    req.accessJti = session.accessJti;
    return true;
  }
}
