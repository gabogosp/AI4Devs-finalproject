import { parseContract } from '@/lib/http/contract';
import { listPendingPaymentOrders, confirmManualPayment } from '@/api/generated/endpoints';
import {
  ListPendingPaymentOrdersResponse,
  ConfirmManualPaymentResponse,
} from '@/api/generated/zod';
import type { PendingPaymentOrder } from '@/api/generated/model';

export type { PendingPaymentOrder };

/**
 * Servicio separado de `ordersService.ts` (concern distinto, backend hermano
 * `US-023-pago-manual-offline-backend` — `design.md` §D9). Misma disciplina:
 * red sólo por operaciones generadas (F48), nunca `fetch` crudo.
 */
export const pendingPaymentsService = {
  async list(signal?: AbortSignal): Promise<PendingPaymentOrder[]> {
    const res = await listPendingPaymentOrders({ signal });
    return parseContract(ListPendingPaymentOrdersResponse, res.data);
  },

  async confirm(orderId: string) {
    const res = await confirmManualPayment(orderId);
    return parseContract(ConfirmManualPaymentResponse, res.data);
  },
};
