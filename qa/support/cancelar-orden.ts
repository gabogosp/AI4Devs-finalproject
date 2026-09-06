import { QA_API_BASE_URL } from './qa-env';

const API = QA_API_BASE_URL;

/**
 * `POST /v1/admin/orders/{id}/cancel` real (US-013) — la acción bajo prueba
 * de este plan, nunca un bridge de siembra (qa-plan.md §6). Mismo patrón que
 * `avanzarEstado`/`confirmarPagoManual` de `seed-metricas.ts`.
 */
export async function cancelarOrden(
  adminToken: string,
  orderId: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${API}/v1/admin/orders/${orderId}/cancel`, {
    method: 'POST',
    headers: { authorization: `Bearer ${adminToken}` },
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
