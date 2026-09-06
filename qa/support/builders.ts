// Builders de test data con defaults deterministas. El único valor no-determinista
// es el prefijo de corrida del SKU/slug (idempotencia entre runs — cada corrida
// usa un prefijo único para no colisionar con el residuo de la anterior), nunca aserido.
const RUN = process.env.QA_RUN_PREFIX ?? `QA${Date.now()}`;

export interface CategoriaInput {
  name: string;
}
export interface ProductoInput {
  sku: string;
  name: string;
  price_ars_cents: number;
  stock: number;
  category_id: string;
  description_raw?: string;
  image_url?: string;
}

let seq = 0;
function uniq(): string {
  seq += 1;
  return `${RUN}-${seq}`;
}

export function nuevaCategoria(over: Partial<CategoriaInput> = {}): CategoriaInput {
  return { name: `Categoría ${uniq()}`, ...over };
}

export function nuevoProducto(
  category_id: string,
  over: Partial<ProductoInput> = {},
): ProductoInput {
  return {
    sku: `SKU-${uniq()}`,
    name: `Producto ${uniq()}`,
    price_ars_cents: 100000,
    stock: 5,
    category_id,
    ...over,
  };
}

/**
 * US-023 §8 — datos de comprador sintéticos, contra el patrón de
 * `CreateCheckoutRequest.buyer` (`apps/api/src/checkout/dto/create-checkout.dto.ts`):
 * `name` (2-120), `email` válido, `phone` con el mismo regex que el DTO exige.
 * Mismo builder que el `qa-plan.md` de US-008 ya proponía y nunca se llegó a
 * implementar — se crea acá porque US-023 lo necesita primero (§8 de su plan).
 */
export interface BuyerInput {
  name: string;
  email: string;
  phone: string;
}

export function buildBuyerData(over: Partial<BuyerInput> = {}): BuyerInput {
  const n = uniq();
  return {
    name: `Comprador QA ${n}`,
    email: `comprador-${n}@qa.dsm.local`,
    phone: '+54 9 11 5555 5555',
    ...over,
  };
}

/** Cuerpo completo de `POST /v1/checkout` (US-023 §8). */
export interface CheckoutBodyInput {
  buyer: BuyerInput;
  consent: boolean;
  fulfillment: 'pickup';
}

export function buildCheckoutBody(
  over: Partial<CheckoutBodyInput> = {},
): CheckoutBodyInput {
  return {
    buyer: buildBuyerData(),
    consent: true,
    fulfillment: 'pickup',
    ...over,
  };
}

/** Identidad de comprador conocida para US-021 (retención/anonimización). */
export interface OrderRetentionFixture {
  buyerName: string;
  buyerEmail: string;
  buyerPhone: string;
}

/**
 * Comprador determinista para `qa/support/seed-orders-retention.ts`: valores
 * conocidos de antemano para poder comparar, después de anonimizar, contra el
 * placeholder real que escribe `apps/api/src/checkout/order-anonymization.ts`
 * — sin importar esas constantes acá (qa-plan.md US-021 §7: comparación por
 * regex del dominio `.invalid`, no un valor hardcodeado dos veces que pueda
 * divergir en silencio de la implementación real).
 */
export function buildOrderRetentionFixture(
  over: Partial<OrderRetentionFixture> = {},
): OrderRetentionFixture {
  const id = uniq();
  return {
    buyerName: `Comprador Retención ${id}`,
    buyerEmail: `comprador-retencion-${id}@qa.dsm.test`,
    buyerPhone: '+54 11 4000-0000',
    ...over,
  };
}
