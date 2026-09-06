import { parseContract } from '@/lib/http/contract';
import { listOrderHistory, getOrderHistoryDetail } from '@/api/generated/endpoints';
import { ListOrderHistoryResponse, GetOrderHistoryDetailResponse } from '@/api/generated/zod';
import type {
  OrderHistorySummary,
  OrderHistoryDetail,
  OrderHistorySummaryStatus,
} from '@/api/generated/model';

/**
 * Tipos DERIVADOS DEL CONTRATO (`frontend-standards.md` §3.1/§3.2). Nunca a mano.
 */
export type { OrderHistorySummary, OrderHistoryDetail };
export type PurchaseStatus = OrderHistorySummaryStatus;

/**
 * Igual que `accountService`: la llamada tiene que salir con cookies de sesión
 * (ADR-0013) — sin la marca, iría al API directo y la cookie no volvería.
 */
const conSesion = { session: 'customer' } as const;

/**
 * Repositorio (`frontend-standards.md` §11.5) sobre `listOrderHistory`/
 * `getOrderHistoryDetail` generados. Sin `sort`/`status` en `list()` a
 * propósito — `ListOrderHistoryParams` sólo declara `limit`/`offset` (AC-1: el
 * orden y el filtro son reglas de negocio del backend, no opciones del
 * cliente).
 */
export const orderHistoryService = {
  async list(params: { limit: number; offset: number }, signal?: AbortSignal) {
    const res = await listOrderHistory(params, { ...conSesion, signal });
    return parseContract(ListOrderHistoryResponse, res.data);
  },

  async get(orderNumber: number, signal?: AbortSignal): Promise<OrderHistoryDetail> {
    const res = await getOrderHistoryDetail(orderNumber, { ...conSesion, signal });
    return parseContract(GetOrderHistoryDetailResponse, res.data);
  },
};
