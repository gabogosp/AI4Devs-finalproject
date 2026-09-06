import { Controller, Delete, HttpCode, Req, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { Response } from 'express';
import { AccountDeletionService } from './account-deletion.service';
import { AccountThrottlerGuard } from './account-throttler.guard';
import { CustomerGuard, RequestConCliente } from '../auth/customer.guard';
import { CsrfGuard } from '../auth/csrf.guard';
import { clearSessionCookies } from '../auth/cookies';

/**
 * Presupuesto del borrado de cuenta, leído de `process.env` (los decoradores
 * se evalúan antes del contenedor). Zod ya validó el valor al arrancar (T0.2).
 */
const ACCOUNT_DELETION_RATE_LIMIT_MAX = Number(
  process.env.ACCOUNT_DELETION_RATE_LIMIT_MAX ?? 5,
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

  private get cookieSecure(): boolean {
    return this.config.get<string>('AUTH_COOKIE_SECURE') !== 'false';
  }
}
