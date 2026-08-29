import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { hashToken } from '../auth/tokens/opaque-token';

/** 32 bytes = 256 bits — igual que `opaque-token.ts` §3.7. */
const TOKEN_BYTES = 32;

export interface IssuedOrderToken {
  /** El claro. Se devuelve **una sola vez** en el 201 y no se persiste. */
  token: string;
  /** Lo único que va a `orders.access_token_hash`. */
  tokenHash: string;
}

/**
 * Identidad opaca de la orden (T2.2) — resuelve OQ-BE-1 del change de US-009.
 *
 * Reusa el `CSPRNG` y `hashToken` de `auth/tokens/opaque-token.ts` (256 bits,
 * SHA-256 en reposo, `security-standards.md` §3.7) — es la tercera vez que el
 * proyecto necesita la misma primitiva (refresh de ADR-0011, carrito de
 * US-007, ahora la orden). `hashToken` es agnóstico al formato del claro que
 * recibe, así que reusarlo no ata este service a la codificación de
 * `newToken()`.
 *
 * **No usa `newToken()` para el claro.** `newToken()` codifica en base64url;
 * el contrato de `POST /v1/payments` (US-009, ya escrito) declara
 * `order_token` con `pattern: '^[0-9a-f]{64}$'` — hex, no base64url. Cambiar
 * la codificación de `newToken()` afectaría refresh/reset/carrito, que no lo
 * piden. Este service genera los mismos 32 bytes de CSPRNG y los codifica en
 * hex acá, sin tocar la primitiva compartida.
 *
 * El `order_id` (UUID) no participa del token en ningún paso: no se puede
 * derivar uno del otro, así que una fuga de base entrega hashes, no acceso.
 */
@Injectable()
export class OrderTokenService {
  issue(): IssuedOrderToken {
    const token = randomBytes(TOKEN_BYTES).toString('hex');
    return { token, tokenHash: hashToken(token) };
  }
}
