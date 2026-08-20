import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { AuthThrottlerGuard } from './auth-throttler.guard';
import { CustomerAuthService } from './customer-auth.service';
import { PasswordResetService } from './password-reset.service';
import { SessionService } from './session.service';
import { CustomersRepository } from './customers.repository';
import { CustomerGuard, RequestConCliente } from './customer.guard';
import { CsrfGuard } from './csrf.guard';
import {
  clearSessionCookies,
  deriveCsrfToken,
  REFRESH_COOKIE,
  setSessionCookies,
} from './cookies';
import {
  CustomerResponseDto,
  LoginDto,
  RegisterDto,
  ResetConfirmDto,
  ResetRequestDto,
} from './dto/customer-auth.dto';
import {
  InvalidRefreshError,
  UnauthenticatedError,
} from '../common/errors/auth-errors';
import { IssuedSession } from './session.service';
import { SafeCustomer } from './customers.repository';

/**
 * Seam de auth de cliente (US-014). Controller fino (§2): valida por DTO,
 * delega en los services, y traduce la sesión a cookies.
 *
 * **Ningún token de sesión viaja en el cuerpo** (AC-9). Toda la emisión pasa por
 * `setSessionCookies`; si alguna ruta devolviera el access en el JSON, un XSS
 * podría leerlo y el `httpOnly` de la cookie no serviría de nada.
 */
@Controller('v1/auth')
// §7.3 — misma disposición que `AdminAuthController`: throttler `auth` por IP,
// y `SkipThrottle` del `storefront` para no mezclar los presupuestos.
@UseGuards(AuthThrottlerGuard)
@SkipThrottle({ storefront: true })
export class CustomerAuthController {
  constructor(
    private readonly auth: CustomerAuthService,
    private readonly sessions: SessionService,
    private readonly reset: PasswordResetService,
    private readonly customers: CustomersRepository,
    private readonly config: ConfigService,
  ) {}

  @Post('register')
  @HttpCode(201)
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ customer: CustomerResponseDto }> {
    const { customer, session } = await this.auth.register(dto);
    return this.responderConSesion(res, customer, session);
  }

  @Post('login')
  @HttpCode(200)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ customer: CustomerResponseDto }> {
    const { customer, session } = await this.auth.login(dto.email, dto.password);
    return this.responderConSesion(res, customer, session);
  }

  /**
   * Renueva la sesión. Lleva `CsrfGuard` pero **no** `CustomerGuard`: el access
   * ya venció, que es justo el motivo por el que se llama a esta ruta. Exigir un
   * access válido acá haría el refresh inalcanzable en el único momento en que
   * sirve.
   */
  @Post('refresh')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ customer: CustomerResponseDto }> {
    const raw = this.leerRefresh(req);
    const session = await this.sessions.rotate(raw);

    const customer = await this.customers.findActiveById(
      this.subDelAccess(session.accessToken),
    );
    if (!customer) {
      // La cuenta se borró entre la emisión y el refresh.
      throw new InvalidRefreshError();
    }

    return this.responderConSesion(res, customer, session);
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(CustomerGuard, CsrfGuard)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const raw = (req as Request & { cookies?: Record<string, string> })
      .cookies?.[REFRESH_COOKIE];
    if (typeof raw === 'string' && raw.length > 0) {
      await this.sessions.revokeFamilyOf(raw);
    }
    // Las cookies se limpian aunque no hubiera refresh que revocar: el usuario
    // pidió cerrar sesión y debe quedar cerrada del lado del cliente igual.
    clearSessionCookies(res, this.cookieSecure);
  }

  @Get('me')
  @UseGuards(CustomerGuard)
  async me(@Req() req: RequestConCliente): Promise<CustomerResponseDto> {
    const customer = await this.customers.findActiveById(req.customerId!);
    if (!customer) {
      // Token válido de una cuenta que ya no está: fail closed.
      throw new UnauthenticatedError();
    }
    return CustomerResponseDto.from(customer);
  }

  /**
   * 202 siempre (AC-11). El service no lanza nunca, así que esta ruta responde
   * lo mismo exista o no la cuenta — que es exactamente el punto.
   */
  @Post('password-reset/request')
  @HttpCode(202)
  async solicitarReset(@Body() dto: ResetRequestDto): Promise<void> {
    await this.reset.request(dto.email);
  }

  /**
   * No emite sesión: quien cambió su contraseña vuelve a entrar por login. Es
   * coherente con que el reset revoque **todas** las sesiones — devolver una
   * nueva acá dejaría viva justo la del que completó el flujo, y ese flujo puede
   * haberlo completado el atacante.
   */
  @Post('password-reset/confirm')
  @HttpCode(200)
  async confirmarReset(@Body() dto: ResetConfirmDto): Promise<void> {
    await this.reset.confirm(dto.token, dto.password);
  }

  private get cookieSecure(): boolean {
    return this.config.get<string>('AUTH_COOKIE_SECURE') !== 'false';
  }

  /** Emite las tres cookies y devuelve el cuerpo público. Único punto de salida. */
  private responderConSesion(
    res: Response,
    customer: SafeCustomer,
    session: IssuedSession,
  ): { customer: CustomerResponseDto } {
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
        secure: this.cookieSecure,
      },
    );

    return { customer: CustomerResponseDto.from(customer) };
  }

  private leerRefresh(req: Request): string {
    const raw = (req as Request & { cookies?: Record<string, string> })
      .cookies?.[REFRESH_COOKIE];
    if (typeof raw !== 'string' || raw.length === 0) {
      throw new InvalidRefreshError();
    }
    return raw;
  }

  /** `sub` del access recién emitido — no requiere verificar: lo firmamos acá. */
  private subDelAccess(accessToken: string): string {
    const [, cuerpo] = accessToken.split('.');
    const claims = JSON.parse(
      Buffer.from(cuerpo, 'base64url').toString('utf8'),
    ) as { sub: string };
    return claims.sub;
  }
}
