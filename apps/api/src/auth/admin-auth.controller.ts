import { Body, Controller, HttpCode, Post } from '@nestjs/common';
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
export class AdminAuthController {
  constructor(private readonly auth: AdminAuthService) {}

  @Post('login')
  @HttpCode(200)
  login(@Body() dto: AdminLoginDto): AdminLoginResponseDto {
    // `loginWithBootstrap` lanza 401 (token inválido) o 503 (auth deshabilitada);
    // el filtro RFC 7807 los traduce sin filtrar detalle del seam.
    return { token: this.auth.loginWithBootstrap(dto.bootstrapToken) };
  }
}
