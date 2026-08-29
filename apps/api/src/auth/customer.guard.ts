import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { UnauthenticatedError } from '../common/errors/auth-errors';
import { ACCESS_COOKIE } from './cookies';
import {
  ACCESS_TOKEN_TYPE,
  JWT_AUDIENCE,
  JWT_ISSUER,
} from './session.service';
import { ROL_CLIENTE } from './customers.repository';

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
 * cosa que no sea un token verificado con todo en orden termina en 401. No hay
 * un solo camino que devuelva `true` por omisión — el `return true` está al
 * final, después de todos los chequeos, y cualquier excepción cae en el `catch`
 * que rechaza.
 */
@Injectable()
export class CustomerGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RequestConCliente>();
    const token = req.cookies?.[ACCESS_COOKIE];

    if (typeof token !== 'string' || token.length === 0) {
      throw new UnauthenticatedError();
    }

    let payload: Record<string, unknown>;
    try {
      payload = await this.jwt.verifyAsync(token, {
        secret: this.config.getOrThrow<string>('JWT_SECRET'),
        // Pin del algoritmo (§3.3). Sin esta línea, un token con `alg: none` o
        // firmado con HS256 usando la clave PÚBLICA de un esquema RS256 podría
        // ser aceptado — es la familia de bugs de confusión de algoritmo, y la
        // librería no protege sola.
        algorithms: ['HS256'],
        // `exp` lo valida la librería; `iss` y `aud` hay que pedirlos explícito.
        // Un token nuestro emitido para otro público no debe abrir esta puerta.
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
      });
    } catch {
      // Firma inválida, vencido, iss/aud que no coinciden, JSON corrupto: todo
      // cae acá y todo termina igual. No se distingue el motivo hacia afuera.
      throw new UnauthenticatedError();
    }

    // `typ` separa access de refresh. Sin este chequeo, un refresh presentado en
    // la cookie de access pasaría — y el refresh vive 30 días contra los 15
    // minutos del access, así que la ventana de una fuga se multiplicaría.
    if (payload.typ !== ACCESS_TOKEN_TYPE) {
      throw new UnauthenticatedError();
    }

    // El rol se chequea acá, no sólo en el handler: un token de admin no abre
    // las rutas de cliente. Son dos superficies distintas y el seam de ADR-0009
    // se mantiene separado en las dos direcciones.
    if (payload.role !== ROL_CLIENTE) {
      throw new UnauthenticatedError();
    }

    if (typeof payload.sub !== 'string' || typeof payload.jti !== 'string') {
      throw new UnauthenticatedError();
    }

    req.customerId = payload.sub;
    req.accessJti = payload.jti;
    return true;
  }
}
