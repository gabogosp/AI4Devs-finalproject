import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import {
  CART_COOKIE,
  deriveCsrfToken,
  setCartCookies,
} from '../auth/cookies';
import { hashToken, newToken } from '../auth/tokens/opaque-token';
import { CartsRepository, CartWithItems } from './carts.repository';

/**
 * Carrito resuelto + el token en claro con el que se resolvió.
 *
 * El token viaja junto al carrito porque re-emitir la cookie (deslizamiento)
 * necesita el claro, y el claro **no** está en la fila: en base sólo vive su
 * hash. Nunca se persiste ni se loguea.
 */
export interface CartSession {
  cart: CartWithItems;
  token: string;
}

/**
 * Identidad del carrito del invitado (US-007 T2.3) — `security-standards.md` §3.7.
 *
 * Reusa las primitivas de US-014 (`newToken` / `hashToken`: 256 bits de CSPRNG,
 * SHA-256 en reposo) porque el problema es el mismo que el del refresh: un
 * identificador de sesión que no se puede adivinar y que una fuga de base no
 * convierte en accesos usables (ADR-0011).
 *
 * El deslizamiento de `expires_at` y el `Max-Age` de la cookie se calculan del
 * **mismo** `CART_TTL_DAYS`, en el mismo lugar. Si divergieran aparecería el peor
 * de los casos: una cookie viva apuntando a una fila vencida, es decir un carrito
 * que "desaparece" sin explicación.
 */
@Injectable()
export class CartTokenService {
  constructor(
    private readonly carts: CartsRepository,
    private readonly config: ConfigService,
  ) {}

  private get ttlDays(): number {
    return this.config.get<number>('CART_TTL_DAYS', 7);
  }

  private get secure(): boolean {
    return this.config.get<string>('AUTH_COOKIE_SECURE', 'true') === 'true';
  }

  private nuevoVencimiento(): Date {
    return this.nextExpiration();
  }

  /**
   * Carrito de la cookie, o `null`.
   *
   * **Purga oportunista**: si la fila existe pero venció, se borra en el acto y se
   * responde como si no hubiera carrito. No hay barrido masivo (el job programado
   * está diferido, OQ-BE-6); con una ventana de 7 días el tráfico real de los
   * mismos clientes mantiene la tabla chica.
   *
   * Una cookie con un token que no existe en base se trata **igual** que no tener
   * cookie: sin error y sin filtrar el motivo.
   */
  async resolve(req: Request): Promise<CartSession | null> {
    const token = (req as Request & { cookies?: Record<string, string> })
      .cookies?.[CART_COOKIE];
    if (typeof token !== 'string' || token.length === 0) return null;

    const cart = await this.carts.findByTokenHash(hashToken(token));
    if (!cart) return null;

    if (cart.expires_at.getTime() <= Date.now()) {
      await this.carts.deleteById(cart.id);
      return null;
    }

    return { cart, token };
  }

  /**
   * Carrito vivo o uno nuevo. Sólo lo llaman las **escrituras**: el `GET` no crea
   * carrito (si lo creara, cualquier crawler dejaría una fila por visita).
   */
  async ensure(req: Request, res: Response): Promise<CartSession> {
    const existente = await this.resolve(req);
    if (existente) return existente;

    const token = newToken();
    const cart = await this.carts.create({
      tokenHash: hashToken(token),
      expiresAt: this.nuevoVencimiento(),
    });
    this.emitirCookies(res, token);

    return { cart: { ...cart, items: [] }, token };
  }

  /**
   * Fin de la ventana de retención para una escritura que ocurre **ahora**.
   *
   * Público a propósito: el caso de uso lo pasa al repositorio para que el
   * deslizamiento de `expires_at` viaje en la **misma transacción** que la
   * escritura de la línea, y el `Max-Age` de la cookie salga del mismo valor. Los
   * dos números tienen un solo origen: `CART_TTL_DAYS`.
   */
  nextExpiration(): Date {
    return new Date(Date.now() + this.ttlDays * 86_400_000);
  }

  /**
   * Re-emite las cookies del carrito tras una escritura (deslizamiento del lado
   * del cliente). Nunca desde un `GET`: eso volvería mutante una operación segura
   * y dejaría la cookie y la fila desfasadas.
   */
  refreshCookies(session: CartSession, res: Response): void {
    this.emitirCookies(res, session.token);
  }

  private emitirCookies(res: Response, token: string): void {
    setCartCookies(
      res,
      {
        token,
        csrfToken: deriveCsrfToken(
          token,
          this.config.getOrThrow<string>('JWT_SECRET'),
        ),
      },
      { ttlDays: this.ttlDays, secure: this.secure },
    );
  }
}
