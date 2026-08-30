import type { Invitado, Respuesta } from './cart-client';

/**
 * Cliente de `POST /v1/checkout` para la suite QA (US-008).
 *
 * No extiende `Invitado` con un método propio (US-007 es dueño de `cart-client.ts`):
 * es una función standalone que reusa el `ctx` del invitado y lee la MISMA cookie
 * `dsm_cart_csrf` que el carrito — el checkout reusa `CartCsrfGuard` tal cual sobre
 * la misma cookie `dsm_cart` (design.md del change de US-008 backend, §Approach).
 */

export interface BuyerInput {
  name: string;
  email: string;
  phone: string;
}

export interface CheckoutBody {
  buyer: BuyerInput;
  consent: boolean;
  fulfillment: 'pickup';
}

export interface CheckoutCreated {
  order_token: string;
  order_number: number;
  status: string;
  total_ars_cents: number;
  items_count: number;
}

/** Body válido por defecto — los escenarios overridean sólo lo que quieren romper. */
export function buildCheckoutBody(overrides: Partial<CheckoutBody> = {}): CheckoutBody {
  return {
    buyer: { name: 'Cliente QA', email: 'cliente.qa@example.com', phone: '+54 9 11 5555 5555' },
    consent: true,
    fulfillment: 'pickup',
    ...overrides,
  };
}

async function csrfDe(invitado: Invitado): Promise<string | undefined> {
  const estado = await invitado.ctx.storageState();
  return estado.cookies.find((c) => c.name === 'dsm_cart_csrf')?.value;
}

/**
 * `POST /v1/checkout`. `conCsrf: false` omite el header a propósito (SC-008-X2):
 * sin él, `CartCsrfGuard` debe rechazar con 403 — mismo patrón que `Invitado.fijar`.
 */
export async function checkout(
  invitado: Invitado,
  body: CheckoutBody,
  { conCsrf = true }: { conCsrf?: boolean } = {},
): Promise<Respuesta<unknown>> {
  const token = conCsrf ? await csrfDe(invitado) : undefined;
  const res = await invitado.ctx.post('/v1/checkout', {
    data: body,
    headers: token ? { 'x-csrf-token': token } : {},
  });
  return {
    status: res.status(),
    body: await res.json().catch(() => undefined),
    headers: res.headers(),
  };
}
