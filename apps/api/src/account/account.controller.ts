import { Body, Controller, Delete, HttpCode, Patch, Req, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { Response } from 'express';
import { AccountDeletionService } from './account-deletion.service';
import { AccountThrottlerGuard } from './account-throttler.guard';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { CustomerGuard, RequestConCliente } from '../auth/customer.guard';
import { CsrfGuard } from '../auth/csrf.guard';
import { clearSessionCookies } from '../auth/cookies';
import { CustomersRepository } from '../auth/customers.repository';
import { CustomerResponseDto } from '../auth/dto/customer-auth.dto';
import { UnauthenticatedError } from '../common/errors/auth-errors';

/**
 * Presupuesto del borrado de cuenta, leído de `process.env` (los decoradores
 * se evalúan antes del contenedor). Zod ya validó el valor al arrancar (T0.2).
 */
const ACCOUNT_DELETION_RATE_LIMIT_MAX = Number(
  process.env.ACCOUNT_DELETION_RATE_LIMIT_MAX ?? 5,
);

/** Mismo criterio que `ACCOUNT_DELETION_RATE_LIMIT_MAX` (US-024). */
const ACCOUNT_PROFILE_UPDATE_RATE_LIMIT_MAX = Number(
  process.env.ACCOUNT_PROFILE_UPDATE_RATE_LIMIT_MAX ?? 20,
);

/**
 * Seam del borrado de cuenta (US-020, `design.md` §Approach — "Controller").
 * Controller fino (§2): sin `@Body()` — la identidad sale ESTRUCTURALMENTE de
 * `req.customerId` (JWT verificado por `CustomerGuard`), nunca de un campo que
 * el cliente pudiera enviar (AC-13). Delega toda la orquestación en
 * `AccountDeletionService`.
 */
@Controller('v1/me')
@UseGuards(AccountThrottlerGuard)
// El presupuesto ajeno se saltea explícitamente — un DELETE no puede consumir
// el cupo de auth, storefront, carrito, enrichment, search, checkout, el
// medio simulado de pagos ni el historial de compras.
@SkipThrottle({
  auth: true,
  storefront: true,
  cart: true,
  enrichment: true,
  search: true,
  checkout: true,
  payments_simulate: true,
  orders_history: true,
})
export class AccountController {
  constructor(
    private readonly deletion: AccountDeletionService,
    private readonly customers: CustomersRepository,
    private readonly config: ConfigService,
  ) {}

  /**
   * `@UseGuards(CustomerGuard, CsrfGuard)` — mismo orden y mismo par que
   * `logout` de `customer-auth.controller.ts` (`security-standards.md` §7.5):
   * primero se verifica quién es, después que el request venga del propio
   * frontend. Las cookies se limpian aunque el borrado ya hubiera ocurrido
   * antes (AC-15/AC-1): el cliente pidió terminar la sesión y debe quedar
   * cerrada del lado del navegador igual.
   */
  @Delete()
  @Throttle({ account_deletion: { limit: ACCOUNT_DELETION_RATE_LIMIT_MAX } })
  @HttpCode(204)
  @UseGuards(CustomerGuard, CsrfGuard)
  async deleteMe(
    @Req() req: RequestConCliente,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.deletion.deleteAccount(req.customerId!);
    clearSessionCookies(res, this.cookieSecure);
  }

  /**
   * `PATCH /v1/me` (US-024) — mismo par de guards y misma fuente estructural
   * de identidad que `deleteMe()` (AC-7): `req.customerId!`, nunca un id del
   * body/query/path. Responde 200 con el perfil actualizado (a diferencia
   * del 204 de `DELETE`) porque el AC-1 pide reflejarlo de inmediato sin un
   * segundo `GET /auth/me`.
   */
  @Patch()
  @Throttle({
    account_profile_update: { limit: ACCOUNT_PROFILE_UPDATE_RATE_LIMIT_MAX },
  })
  @HttpCode(200)
  @UseGuards(CustomerGuard, CsrfGuard)
  async updateProfile(
    @Req() req: RequestConCliente,
    @Body() dto: UpdateProfileDto,
  ): Promise<CustomerResponseDto> {
    const actualizado = await this.customers.updateProfile(req.customerId!, {
      name: dto.name,
      avatar_url: dto.avatar_url,
    });
    if (!actualizado) {
      throw new UnauthenticatedError();
    }
    return CustomerResponseDto.from(actualizado);
  }

  private get cookieSecure(): boolean {
    return this.config.get<string>('AUTH_COOKIE_SECURE') !== 'false';
  }
}
