import { seedCarrito, type SeedCarrito } from './seed-carrito';
import { nuevoInvitado, type Invitado } from './cart-client';

/**
 * US-008 §7 — la siembra que los steps de `checkout.feature` (Antecedentes)
 * necesitan: reusa `seedCarrito()` (US-007, siete productos ya listos) y le
 * agrega un invitado con un carrito de **dos productos distintos**, tal como
 * pide el Antecedentes de la Característica ("un invitado con un carrito con
 * 2 productos").
 *
 * Nunca INSERT directo: el carrito se arma con las mismas dos escrituras
 * reales (`PUT /v1/cart/items/:slug`) que usaría un comprador de verdad —
 * mismo criterio que `seedCarrito()` y `seedPendingPaymentOrder()`.
 */
export interface SeedCheckout {
  seed: SeedCarrito;
  invitado: Invitado;
  /** Los dos slugs que quedaron en el carrito, en el orden en que se agregaron. */
  slugs: [string, string];
}

export async function seedCheckoutConCarrito(): Promise<SeedCheckout> {
  const seed = await seedCarrito();
  const invitado = await nuevoInvitado();

  const productos: [string, string] = [seed.mixtoA.slug, seed.mixtoB.slug];
  for (const slug of productos) {
    const alta = await invitado.fijar(slug, 1);
    if (alta.status !== 200) {
      await invitado.cerrar();
      throw new Error(
        `[qa/seed-checkout] no se pudo agregar ${slug} al carrito: ` +
          `${alta.status} ${JSON.stringify(alta.body)}`,
      );
    }
  }

  return { seed, invitado, slugs: productos };
}

export { buildBuyerData, buildCheckoutBody } from './builders';
