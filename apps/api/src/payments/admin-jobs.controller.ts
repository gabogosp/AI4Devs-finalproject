import { Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../auth/admin.guard';
import { CleanupAbandonedOrdersService } from './cleanup-abandoned-orders.service';
import { ReconcilePaymentsService, ReconcileResult } from './reconcile-payments.service';
import { RefundRetryResult, RefundRetryService } from './refund-retry.service';

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
  constructor(
    private readonly reconcilePayments: ReconcilePaymentsService,
    private readonly cleanupAbandonedOrders: CleanupAbandonedOrdersService,
    private readonly refundRetry: RefundRetryService,
  ) {}

  @Post('v1/admin/payments/reconcile')
  @HttpCode(200)
  async reconcile(): Promise<ReconcileResult> {
    return this.reconcilePayments.reconcile();
  }

  @Post('v1/admin/orders/cleanup-abandoned')
  @HttpCode(200)
  async cleanupAbandoned(): Promise<{ cancelled: number }> {
    return this.cleanupAbandonedOrders.cleanupAbandoned();
  }

  @Post('v1/admin/payments/retry-refunds')
  @HttpCode(200)
  async retryRefunds(): Promise<RefundRetryResult> {
    return this.refundRetry.retryPending();
  }
}
