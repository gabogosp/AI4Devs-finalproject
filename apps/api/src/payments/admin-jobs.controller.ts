import { Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../auth/admin.guard';
import { ReconcilePaymentsService, ReconcileResult } from './reconcile-payments.service';

/**
 * Jobs admin de US-010 (`design.md` §D8): sin scheduler in-process
 * (ADR-0012/0014) — un cron externo (Railway/GitHub Actions) los dispara
 * cada N minutos. Sin throttler dedicado — mismo criterio que
 * `PaymentConfirmationController`: superficie admin de bajo volumen, un
 * solo operador. `Cache-Control: no-store` lo pone el middleware global de
 * `/v1/admin/*` (`bootstrap.ts`).
 */
// Sin prefijo de clase: las 3 rutas de este controller NO comparten base
// (`/v1/admin/payments/reconcile`, `/v1/admin/orders/cleanup-abandoned`,
// `/v1/admin/payments/retry-refunds` — `design.md` §D8) — cada handler
// declara su path completo.
@Controller()
@UseGuards(AdminGuard)
export class AdminJobsController {
  constructor(private readonly reconcilePayments: ReconcilePaymentsService) {}

  @Post('v1/admin/payments/reconcile')
  @HttpCode(200)
  async reconcile(): Promise<ReconcileResult> {
    return this.reconcilePayments.reconcile();
  }
}
