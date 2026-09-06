import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { ACCESS_COOKIE } from './cookies';
import type { RequestConCliente } from './customer.guard';
import {
  ACCESS_TOKEN_TYPE,
  JWT_AUDIENCE,
  JWT_ISSUER,
} from './session.service';
import { ROL_CLIENTE } from './customers.repository';

/** Resultado de una sesión de cliente resuelta con éxito. */
export interface CustomerSession {
  customerId: string;
  accessJti: string;
}

/**
 * Verifica la cookie de access de cliente y devuelve la sesión resuelta, o
 * `null` si por cualquier motivo no es una sesión válida.
 *
 * Extraído (Extract Method, `refactoring-discipline`) de `CustomerGuard`
 * (US-014) — es la MISMA verificación, carácter por carácter: cookie
 * `ACCESS_COOKIE`, `algorithms: ['HS256']` pineado, `issuer`/`audience`
 * verificados, `typ === 'access'`, `role === ROL_CLIENTE`, `sub`/`jti`
 * presentes. La única diferencia con el guard es qué hace la LLAMADORA cuando
 * esto devuelve `null`: `CustomerGuard` lanza `UnauthenticatedError()`
 * (fail-closed, `security-standards.md` §3.8); `OptionalCustomerGuard` sigue
 * sin sesión (fail-open deliberado, la excepción documentada al principio).
 *
 * Esta función **nunca lanza** — cualquier motivo de rechazo colapsa a `null`,
 * para que ambos guards puedan decidir qué hacer con eso sin un `try/catch`
 * propio.
 */
export async function resolveCustomerSession(
  req: Request,
  jwt: JwtService,
  config: ConfigService,
): Promise<CustomerSession | null> {
  const token = req.cookies?.[ACCESS_COOKIE];

  if (typeof token !== 'string' || token.length === 0) {
    return null;
  }

  let payload: Record<string, unknown>;
  try {
    payload = await jwt.verifyAsync(token, {
      secret: config.getOrThrow<string>('JWT_SECRET'),
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
    // cae acá y todo colapsa igual a `null`.
    return null;
  }

  // `typ` separa access de refresh. Sin este chequeo, un refresh presentado en
  // la cookie de access pasaría — y el refresh vive 30 días contra los 15
  // minutos del access, así que la ventana de una fuga se multiplicaría.
  if (payload.typ !== ACCESS_TOKEN_TYPE) {
    return null;
  }

  // El rol se chequea acá, no sólo en el handler: un token de admin no abre
  // las rutas de cliente. Son dos superficies distintas y el seam de ADR-0009
  // se mantiene separado en las dos direcciones.
  if (payload.role !== ROL_CLIENTE) {
    return null;
  }

  if (typeof payload.sub !== 'string' || typeof payload.jti !== 'string') {
    return null;
  }

  return { customerId: payload.sub, accessJti: payload.jti };
}

/**
 * Variante de `CustomerGuard` que **nunca bloquea** (US-015, design.md §D1).
 *
 * `security-standards.md` §3.8 establece fail-closed como la norma en el seam
 * de sesión de cliente — esta clase es la excepción deliberada y documentada,
 * no una regresión del principio: existe exclusivamente para que
 * `POST /v1/checkout` (guest-first, US-008) pueda resolver `customerId`
 * *cuando existe* sin dejar de aceptar compradores sin sesión.
 *
 * Si hay sesión válida, deja `req.customerId`/`req.accessJti` (igual que
 * `CustomerGuard`). Si no la hay — cookie ausente, inválida, vencida, o de un
 * rol que no es `customer` — sigue de largo sin setear nada. `return true` es
 * el único camino posible: no hay rama que lance.
 */
@Injectable()
export class OptionalCustomerGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RequestConCliente>();
    const session = await resolveCustomerSession(req, this.jwt, this.config);

    if (session) {
      req.customerId = session.customerId;
      req.accessJti = session.accessJti;
    }

    return true; // NUNCA bloquea — el checkout sigue siendo guest-first
  }
}
