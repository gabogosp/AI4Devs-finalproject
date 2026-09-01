import { parseContract } from '@/lib/http/contract';
import {
  listAdminOrders,
  getAdminOrder,
  updateAdminOrderStatus,
} from '@/api/generated/endpoints';
import {
  ListAdminOrdersResponse,
  GetAdminOrderResponse,
  UpdateAdminOrderStatusResponse,
} from '@/api/generated/zod';
import type {
  AdminOrderSummary,
  AdminOrderDetail,
  AdminOrderSummaryStatus,
  UpdateAdminOrderStatusStatus,
} from '@/api/generated/model';

/**
 * Tipos DERIVADOS DEL CONTRATO — generados desde `apps/api/docs/api/openapi.yaml`
 * (`frontend-standards.md` §3.1/§3.2). Se re-exportan con los nombres de dominio
 * que usa el panel; nunca se declaran a mano.
 */
export type { AdminOrderSummary as OrderSummary, AdminOrderDetail as OrderDetail };
export type OrderStatus = AdminOrderSummaryStatus;
export type FulfillmentTarget = UpdateAdminOrderStatusStatus;

/**
 * Lógica de servicio del panel de fulfillment (US-012, `design.md` §D2/D3).
 * La red va por las operaciones **generadas** (F48). `sort` es un solo param
 * canónico (`-created_at` = desc), ratificado por
 * `US-012-panel-ordenes-dueno-backend` design.md §D5 — no dos params
 * separados. `updateStatus` manda `idempotency-key` (defensivo — el backend
 * lo acepta y lo ignora, idempotencia estructural por su lado).
 */
export const ordersService = {
  async list(
    params: { status?: OrderStatus; limit: number; offset: number; sort?: string },
    signal?: AbortSignal,
  ) {
    const res = await listAdminOrders(params, { signal });
    return parseContract(ListAdminOrdersResponse, res.data);
  },

  async get(id: string, signal?: AbortSignal): Promise<AdminOrderDetail> {
    const res = await getAdminOrder(id, { signal });
    return parseContract(GetAdminOrderResponse, res.data);
  },

  async updateStatus(
    id: string,
    status: FulfillmentTarget,
    idempotencyKey: string,
  ): Promise<AdminOrderDetail> {
    const res = await updateAdminOrderStatus(
      id,
      { status },
      { headers: { 'idempotency-key': idempotencyKey } },
    );
    return parseContract(UpdateAdminOrderStatusResponse, res.data);
  },
};
