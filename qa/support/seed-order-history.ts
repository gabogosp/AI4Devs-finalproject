import { adminAuth } from './admin-auth';
import { apiCall } from './api';
import { buildBuyerData, buildCheckoutBody, nuevaCategoria, nuevoProducto } from './builders';
import { Invitado, type CheckoutCreated } from './cart-client';
import { nuevaCuenta, type Sesion } from './customer-auth';
import { QA_API_BASE_URL } from './qa-env';

/**
 * T0.1 (`qa-plan.md` §9, `design.md` §D-QA3) — el helper que le falta al
 * harness: un cliente CON sesión que compra y confirma el pago. Sin esto, el
 * historial de cualquier escenario listaría siempre cero filas (AC-1 sólo
 * cuenta compras hechas logueado).
 */

const API = QA_API_BASE_URL;

/**
 * Categoría + producto publicado con stock, vía la API admin real — nunca
 * INSERT directo. Cada llamada siembra SU PROPIO producto (nunca reusa el de
 * otro escenario, `qa-plan.md` §9 "cada escenario siembra su propia cuenta y
 * su propia orden"). El step "Dado un catálogo sembrado con productos
 * disponibles" reusado del Antecedentes es un no-op deliberado (mismo
 * criterio que `pago-manual.steps.ts`/`retencion-ordenes.steps.ts`): el
 * catálogo real lo siembra este helper, invocado desde cada `Given` puntual.
 */
export async function sembrarProductoPublicado(): Promise<string> {
  const token = await adminAuth();
  const categoria = await apiCall<{ id: string }>(
    '/v1/admin/categories',
    'POST',
    token,
    nuevaCategoria(),
  );
  const creado = await apiCall<{ id: string; slug: string }>(
    '/v1/admin/products',
    'POST',
    token,
    nuevoProducto(categoria.id, { stock: 5 }),
  );
  await apiCall(`/v1/admin/products/${creado.id}`, 'PATCH', token, { status: 'published' });
  return creado.slug;
}

export interface CompraLogueada {
  sesion: Sesion;
  orderNumber: number;
  orderToken: string;
  totalArsCents: number;
}

async function comprarConSesion(slug: string, sufijoCuenta: string): Promise<{
  sesion: Sesion;
  checkout: CheckoutCreated;
}> {
  const sesion = await nuevaCuenta(sufijoCuenta);
  // `Invitado` (pese al nombre) es un wrapper agnóstico de `APIRequestContext`
  // — envolver acá el `ctx` de una cuenta CON sesión ejercita exactamente el
  // camino que `OptionalCustomerGuard` intercepta (design.md §D-QA3, Trade-offs).
  const invitado = new Invitado(sesion.ctx);
  const alta = await invitado.fijar(slug, 1);
  if (alta.status !== 200) {
    throw new Error(
      `[qa/seed-order-history] no se pudo agregar ${slug} x1 al carrito: ` +
        `${alta.status} ${JSON.stringify(alta.body)}`,
    );
  }
  const checkoutRes = await invitado.checkout(
    buildCheckoutBody({ buyer: buildBuyerData({ email: sesion.cuenta.email }) }),
  );
  if (checkoutRes.status !== 201) {
    throw new Error(
      `[qa/seed-order-history] POST /v1/checkout → ${checkoutRes.status}: ` +
        `${JSON.stringify(checkoutRes.body)}`,
    );
  }
  return { sesion, checkout: checkoutRes.body };
}

/**
 * Cliente CON sesión que compra un producto y CONFIRMA el pago (medio
 * simulado "DSM", US-010) — deja una orden real con `customer_id` seteado y
 * `status !== 'pending_payment'` (design.md §D-QA3).
 *
 * `simulate-payment` no necesita la cookie de sesión (verificado en
 * `checkout.controller.ts` — sólo toma `order_token` en el body): se llama
 * con `fetch` simple, mismo patrón de forma que `simularPagoAutomatico()` de
 * `seed-metricas.ts` (reusado como referencia, no importado — vive en otro
 * namespace).
 */
export async function compraLogueada(slug: string, sufijoCuenta = ''): Promise<CompraLogueada> {
  const { sesion, checkout } = await comprarConSesion(slug, sufijoCuenta);
  const confirm = await fetch(`${API}/v1/checkout/simulate-payment`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ order_token: checkout.order_token }),
  });
  if (confirm.status !== 200) {
    throw new Error(
      `[qa/seed-order-history] simulate-payment → ${confirm.status}: ${await confirm.text()}`,
    );
  }
  return {
    sesion,
    orderNumber: checkout.order_number,
    orderToken: checkout.order_token,
    totalArsCents: checkout.total_ars_cents,
  };
}

/**
 * Misma compra, SIN confirmar — la orden queda `pending_payment` (AC-1 la
 * excluye, `SC-015-C4`).
 */
export async function compraLogueadaPendiente(
  slug: string,
  sufijoCuenta = '',
): Promise<CompraLogueada> {
  const { sesion, checkout } = await comprarConSesion(slug, sufijoCuenta);
  return {
    sesion,
    orderNumber: checkout.order_number,
    orderToken: checkout.order_token,
    totalArsCents: checkout.total_ars_cents,
  };
}
