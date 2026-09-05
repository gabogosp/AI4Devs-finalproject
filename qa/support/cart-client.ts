import { request, type APIRequestContext } from '@playwright/test';

import { QA_API_BASE_URL, QA_WEB_BASE_URL } from './qa-env';

const API = QA_API_BASE_URL;
/** Origen que la allowlist de CORS del API debe admitir; el `CartCsrfGuard` lo verifica. */
const WEB = QA_WEB_BASE_URL;

/**
 * Estados de una línea, tal como los declara el contrato. No es un booleano:
 * `insufficient_stock` (publicado pero sin stock suficiente) y `unavailable`
 * (borrador o archivado) son casos distintos que AC-6 diferencia.
 */
export type Disponibilidad = 'available' | 'insufficient_stock' | 'unavailable';

export interface CartItem {
  slug: string;
  name: string;
  image_url: string | null;
  quantity: number;
  unit_price_ars_cents: number;
  currency: string;
  subtotal_ars_cents: number;
  availability: Disponibilidad;
  max_quantity: number;
  price_changed: boolean;
}

/** Una línea es comprable sólo si está plenamente disponible. */
export function esComprable(item: CartItem): boolean {
  return item.availability === 'available';
}

export interface Cart {
  id: string | null;
  items: CartItem[];
  total_ars_cents: number;
  item_count: number;
  total_quantity: number;
  has_blocking_issues: boolean;
  updated_at: string | null;
}

/**
 * El contrato devuelve el carrito **envuelto** (`CartEnvelope` → `{ cart }`).
 * Se desenvuelve acá, en un solo lugar, para que los escenarios lean el carrito
 * y no la forma del sobre.
 */
interface CartEnvelope {
  cart: Cart;
}

export interface Respuesta<T> {
  status: number;
  body: T;
  /** Cabeceras de la respuesta: X-2 asserta que el carrito no sea cacheable. */
  headers: Record<string, string>;
}

/** Entrada de `POST /v1/checkout` — mismo shape que `CreateCheckoutRequest` (US-023 §8). */
export interface CheckoutBody {
  buyer: { name: string; email: string; phone: string };
  consent: boolean;
  fulfillment: 'pickup';
}

/** Respuesta `201` de `POST /v1/checkout` (`CheckoutCreated`, sin `order_id` interno). */
export interface CheckoutCreated {
  order_token: string;
  order_number: number;
  status: string;
  total_ars_cents: number;
  items_count: number;
}

/**
 * Un invitado del carrito: un `APIRequestContext` con su **propio almacén de
 * cookies**, que es lo que le da identidad ante el servidor.
 *
 * Ninguna función recibe ni expone el token de `dsm_cart` a mano: pasarlo
 * probaría que el servidor acepta un token, no que el invitado conserva su
 * carrito, que es lo que AC-4 afirma.
 */
export class Invitado {
  ctx: APIRequestContext;

  // Sin TS parameter property (`constructor(public ctx: ...)`): el modo de
  // type-stripping nativo de Node (el que usa Playwright al parsear .spec.ts
  // en Node ≥22) no lo soporta — sólo borra tipos, no emite class fields desde
  // el constructor. Mismo comportamiento, sintaxis compatible con ambos
  // transforms (tsx de Cucumber y el nativo de Playwright).
  constructor(ctx: APIRequestContext) {
    this.ctx = ctx;
  }

  /** Lee la cookie de CSRF. Es legible a propósito: el double-submit la exige. */
  private async csrf(): Promise<string | undefined> {
    const estado = await this.ctx.storageState();
    return estado.cookies.find((c) => c.name === 'dsm_cart_csrf')?.value;
  }

  async ver(): Promise<Respuesta<Cart>> {
    const res = await this.ctx.get('/v1/cart');
    const sobre = (await res.json()) as CartEnvelope;
    return { status: res.status(), body: sobre.cart, headers: res.headers() };
  }

  /**
   * Fija la cantidad **absoluta** de un producto. `conCsrf: false` omite el
   * header a propósito, para probar que el guard rechaza — sin ese caso, el
   * cliente podría estar esquivando el CSRF sin que nadie lo note.
   */
  async fijar(
    slug: string,
    quantity: number,
    { conCsrf = true }: { conCsrf?: boolean } = {},
  ): Promise<Respuesta<unknown>> {
    const token = conCsrf ? await this.csrf() : undefined;
    const res = await this.ctx.put(`/v1/cart/items/${slug}`, {
      data: { quantity },
      headers: token ? { 'x-csrf-token': token } : {},
    });
    return {
      status: res.status(),
      body: await res.json().catch(() => undefined),
      headers: res.headers(),
    };
  }

  /**
   * `POST /v1/checkout` (US-008) — convierte el carrito del invitado en una
   * orden real `pending_payment`. Reusa el mismo `CartCsrfGuard` que las
   * escrituras del carrito (US-023 §8): mismo double-submit, mismo `Origin`.
   */
  async checkout(body: CheckoutBody): Promise<Respuesta<CheckoutCreated>> {
    const token = await this.csrf();
    const res = await this.ctx.post('/v1/checkout', {
      data: body,
      headers: token ? { 'x-csrf-token': token } : {},
    });
    return {
      status: res.status(),
      body: (await res.json().catch(() => undefined)) as CheckoutCreated,
      headers: res.headers(),
    };
  }

  async quitar(slug: string): Promise<Respuesta<unknown>> {
    const token = await this.csrf();
    const res = await this.ctx.delete(`/v1/cart/items/${slug}`, {
      headers: token ? { 'x-csrf-token': token } : {},
    });
    return {
      status: res.status(),
      body: await res.json().catch(() => undefined),
      headers: res.headers(),
    };
  }

  async cerrar(): Promise<void> {
    await this.ctx.dispose();
  }
}

/** Invitado nuevo, aislado de cualquier otro: su propio almacén de cookies. */
export async function nuevoInvitado(): Promise<Invitado> {
  const ctx = await request.newContext({
    baseURL: API,
    // El `CartCsrfGuard` verifica `Origin` contra la allowlist, no sólo el
    // double-submit: sin este header toda escritura muere en 403.
    extraHTTPHeaders: { origin: WEB },
  });
  return new Invitado(ctx);
}

/**
 * «Cerrar el navegador y volver» (AC-4): se serializa el estado, se descarta el
 * contexto y se abre uno nuevo con ese estado. Sólo sobreviven las cookies
 * persistentes — que es exactamente lo que el criterio afirma.
 */
export async function reabrir(invitado: Invitado): Promise<Invitado> {
  const estado = await invitado.ctx.storageState();
  await invitado.cerrar();

  const ctx = await request.newContext({
    baseURL: API,
    extraHTTPHeaders: { origin: WEB },
    storageState: estado,
  });
  return new Invitado(ctx);
}
