import { compraLogueadaConSesion } from './seed-order-history';
import { idPorOrderNumber, avanzarEstado, type FulfillmentStatus } from './seed-ordenes';
import type { Sesion } from './customer-auth';

/**
 * US-025 — Helper de siembra: una compra LOGUEADA (con `customer_id` real,
 * a diferencia de `crearOrdenEnEstado` de `seed-ordenes.ts`, que es SIEMPRE
 * invitado — `checkoutReal` usa `nuevoInvitado()`) que llega a `delivered`.
 *
 * La elegibilidad de reseñar (`ReviewsService.upsertOwn`) consulta
 * `orders.customer_id`, así que una orden de invitado NUNCA habilita a
 * reseñar sin importar el estado — este helper es el único camino real para
 * sembrar un cliente elegible (`design.md` D-QA2, ajustado tras leer el
 * código real de `OrdersRepository.hasDeliveredOrderWithProduct`).
 *
 * Reusa `compraLogueadaConSesion` (checkout + `simulate-payment`, deja la
 * orden en `new`) + los mismos `PATCH` admin de `avanzarEstado` que
 * `crearOrdenEnEstado` usa para el resto de la FSM — nunca `UPDATE` directo.
 */
export async function compraEntregada(
  sesion: Sesion,
  slug: string,
  adminToken: string,
): Promise<{ orderId: string; orderNumber: number }> {
  const { orderNumber } = await compraLogueadaConSesion(sesion, slug);
  const orderId = await idPorOrderNumber(orderNumber);

  const pasos: FulfillmentStatus[] = ['preparing', 'ready', 'delivered'];
  for (const paso of pasos) {
    const r = await avanzarEstado(adminToken, orderId, paso);
    if (r.status !== 200) {
      throw new Error(
        `[qa/seed-resenas] PATCH a "${paso}" devolvió ${r.status} — ${JSON.stringify(r.body)}`,
      );
    }
  }

  return { orderId, orderNumber };
}
