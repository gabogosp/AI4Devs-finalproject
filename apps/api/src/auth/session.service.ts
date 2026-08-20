import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InvalidRefreshError } from './auth-errors';
import { RefreshTokensRepository } from './refresh-tokens.repository';
import { hashToken, newToken } from './tokens/opaque-token';

/**
 * Emisor y `issuer`/`audience` de los access tokens. Constantes, no configuración:
 * identifican al servicio, no al entorno. Se validan al verificar (T4.3) — un
 * token firmado con nuestra clave pero emitido para otro público debe rechazarse.
 */
export const JWT_ISSUER = 'dsm-api';
export const JWT_AUDIENCE = 'dsm-storefront';

/** Marca el propósito del token: un refresh nunca debe pasar por access. */
export const ACCESS_TOKEN_TYPE = 'access';

export interface AccessTokenClaims {
  sub: string;
  role: string;
  typ: typeof ACCESS_TOKEN_TYPE;
  jti: string;
}

export interface IssuedSession {
  accessToken: string;
  refreshToken: string;
  jti: string;
  familyId: string;
}

/**
 * Ciclo de vida de la sesión — ADR-0011 + `security-standards.md` §3.3.
 *
 * El access es un JWT stateless de vida corta; el refresh es **opaco** y vive en
 * la base, hasheado. Ese reparto es lo que hace que el logout revoque de verdad
 * (AC-3) sin pagar una consulta por request: el estado está en el camino del
 * refresh, que ocurre una vez por TTL de access, no en el de cada petición.
 */
@Injectable()
export class SessionService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly refreshTokens: RefreshTokensRepository,
  ) {}

  private get secret(): string {
    return this.config.getOrThrow<string>('JWT_SECRET');
  }

  private get accessTtlMin(): number {
    return this.config.get<number>('AUTH_ACCESS_TTL_MIN') ?? 15;
  }

  private get refreshTtlDays(): number {
    return this.config.get<number>('AUTH_REFRESH_TTL_DAYS') ?? 30;
  }

  /** Abre una sesión nueva: familia nueva, primer refresh de esa familia. */
  async issue(customer: { id: string; role: string }): Promise<IssuedSession> {
    return this.emitir(customer, randomUUID());
  }

  /**
   * Rota el refresh presentado.
   *
   * El orden importa y es el que sostiene la detección de reuso: primero se
   * busca **sin filtrar por estado** (por eso el repositorio no filtra), y recién
   * después se juzga. Un token con `rotated_at` o `revoked_at` no es un token
   * inválido cualquiera: es la firma de un replay, y la respuesta correcta es
   * matar la familia entera, no sólo negar esta petición.
   */
  async rotate(rawRefreshToken: string): Promise<IssuedSession> {
    const fila = await this.refreshTokens.findByHash(
      hashToken(rawRefreshToken),
    );

    if (!fila) {
      throw new InvalidRefreshError();
    }

    if (fila.rotated_at !== null || fila.revoked_at !== null) {
      // Reuso: alguien presentó un token que ya se consumió. O bien el legítimo
      // lo replayó (inofensivo pero indistinguible), o bien fue robado. Ante la
      // duda se asume lo segundo — el costo de equivocarse es un re-login; el de
      // no hacerlo es una sesión ajena viva.
      await this.refreshTokens.revokeFamily(fila.family_id);
      throw new InvalidRefreshError();
    }

    if (fila.expires_at.getTime() <= Date.now()) {
      throw new InvalidRefreshError();
    }

    const cliente = { id: fila.customer_id, role: 'customer' };
    // Se marca rotado ANTES de emitir el sucesor: si la emisión fallara, el
    // usuario se queda sin sesión y vuelve a entrar. Al revés quedaría un token
    // viejo vivo junto a uno nuevo, que es exactamente la ventana que la
    // rotación existe para cerrar.
    await this.refreshTokens.markRotated(fila.id);
    return this.emitir(cliente, fila.family_id);
  }

  /**
   * Logout (AC-3): revoca la familia del token presentado.
   *
   * No lanza si el token no existe. Cerrar sesión con una cookie ya vencida es
   * el resultado que el usuario pidió, y un 401 acá sólo dejaría al cliente sin
   * saber si limpiar su estado local.
   */
  async revokeFamilyOf(rawRefreshToken: string): Promise<void> {
    const fila = await this.refreshTokens.findByHash(
      hashToken(rawRefreshToken),
    );
    if (fila) {
      await this.refreshTokens.revokeFamily(fila.family_id);
    }
  }

  /** Reset de contraseña (§3.7): se cae toda sesión de la cuenta. */
  async revokeAllForCustomer(customerId: string): Promise<number> {
    return this.refreshTokens.revokeAllForCustomer(customerId);
  }

  private async emitir(
    customer: { id: string; role: string },
    familyId: string,
  ): Promise<IssuedSession> {
    const jti = randomUUID();
    const accessToken = this.jwt.sign(
      {
        sub: customer.id,
        role: customer.role,
        typ: ACCESS_TOKEN_TYPE,
        jti,
      } satisfies AccessTokenClaims,
      {
        secret: this.secret,
        expiresIn: `${this.accessTtlMin}m`,
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
      },
    );

    const rawRefresh = newToken();
    const expiresAt = new Date(
      Date.now() + this.refreshTtlDays * 24 * 60 * 60 * 1000,
    );
    await this.refreshTokens.issue({
      customerId: customer.id,
      tokenHash: hashToken(rawRefresh),
      familyId,
      expiresAt,
    });

    // Limpieza oportunista: barre las filas ya vencidas de este cliente. Acotada
    // a propósito (ver el repositorio) — no reemplaza la purga programada, que
    // está diferida por falta de Redis.
    await this.refreshTokens.purgeExpiredForCustomer(customer.id);

    return { accessToken, refreshToken: rawRefresh, jti, familyId };
  }
}
