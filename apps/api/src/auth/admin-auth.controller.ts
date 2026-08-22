import {
  Body,
  Controller,
  HttpCode,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { deriveCsrfToken, setSessionCookies } from './cookies';
import { SessionService } from './session.service';
import { SkipThrottle } from '@nestjs/throttler';
import { AuthThrottlerGuard } from './auth-throttler.guard';
import { AdminAuthService } from './admin-auth.service';
import { AdminLoginDto, AdminLoginResponseDto } from './dto/admin-auth.dto';

/**
 * Ruta HTTP del seam de auth admin (ADR-0009) — la costura que consume el panel
 * (`adminSession.login`). Es la ÚNICA ruta bajo `/v1/admin/*` que NO lleva
 * `AdminGuard`: es la que emite el token, así que exigirlo sería circular.
 *
 * Alcance deliberado (mismo del service): intercambio del bootstrap token por un
 * JWT `role=admin`. Sin registro de usuarios, refresh rotado ni 2FA — eso lo
 * entrega US-014, que reemplaza esta emisión preservando el contrato `role=admin`.
 */
@Controller('v1/admin/auth')
// §7.3 — la superficie de auth va con throttle por IP (429 + Retry-After al
// excederlo). El brute-force del bootstrap token es el vector obvio de esta ruta.
// `@SkipThrottle({ storefront: true })` deja fuera el throttler público de
// US-003: esta ruta sólo la limita el throttler `auth` (semántica intacta).
@UseGuards(AuthThrottlerGuard)
@SkipThrottle({ storefront: true, cart: true })
export class AdminAuthController {
  constructor(
    private readonly auth: AdminAuthService,
    private readonly sessions: SessionService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Dos caminos, **una** ruta y **una** forma de respuesta.
   *
   * Que el shape sea `{ token }` en los dos casos es lo que hace este cambio
   * aditivo: el panel de US-001 sigue funcionando sin tocar una línea, que es lo
   * que ADR-0009 prometió al aceptar el seam interino.
   */
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() dto: AdminLoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AdminLoginResponseDto> {
    if (dto.email && dto.password) {
      const { token, customer } = await this.auth.loginWithCredentials(
        dto.email,
        dto.password,
      );

      // Además del token en el cuerpo (contrato de US-001), se emiten cookies:
      // es el camino por el que el panel migrará cuando deje de guardar el token
      // en memoria. Los dos conviven sin romper a nadie.
      const session = await this.sessions.issue({
        id: customer.id,
        role: customer.role,
      });
      setSessionCookies(
        res,
        {
          accessToken: session.accessToken,
          refreshToken: session.refreshToken,
          csrfToken: deriveCsrfToken(
            session.jti,
            this.config.getOrThrow<string>('JWT_SECRET'),
          ),
        },
        {
          accessTtlMin: this.config.get<number>('AUTH_ACCESS_TTL_MIN') ?? 15,
          refreshTtlDays: this.config.get<number>('AUTH_REFRESH_TTL_DAYS') ?? 30,
          secure: this.config.get<string>('AUTH_COOKIE_SECURE') !== 'false',
        },
      );

      return { token };
    }

    // `loginWithBootstrap` lanza 401 (token inválido) o 503 (auth deshabilitada);
    // el filtro RFC 7807 los traduce sin filtrar detalle del seam.
    return { token: this.auth.loginWithBootstrap(dto.bootstrapToken ?? '') };
  }
}
