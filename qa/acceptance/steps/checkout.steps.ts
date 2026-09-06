import assert from 'node:assert/strict';
import { AfterAll, Given, Then, When } from '@cucumber/cucumber';
// `@dsm/db` es CJS y `@dsm/qa` es ESM: los named exports no son analizables
// estáticamente — mismo patrón que `pago-manual.steps.ts`/`seed-ordenes.ts`.
import db from '@dsm/db';
import { apiCall } from '../../support/api';
import { nuevoInvitado, type CheckoutCreated, type Invitado } from '../../support/cart-client';
import { buildBuyerData, buildCheckoutBody, seedCheckoutConCarrito } from '../../support/seed-checkout';
import type { ProductoSembrado, SeedCarrito } from '../../support/seed-carrito';
import type { CatalogWorld } from './world';

const { PrismaClient } = db as unknown as { PrismaClient: new () => PrismaLike };

/** Sólo la forma mínima que estos pasos necesitan — evita `any` suelto. */
interface OrderItemRow {
  product_id: string;
  quantity: number;
  unit_price_ars_cents: number;
}
interface OrderRow {
  order_number: number;
  status: string;
  total_ars_cents: number;
  consent_accepted: boolean;
  consent_accepted_at: Date;
  consent_terms_version: string;
  items: OrderItemRow[];
}
interface ColumnRow {
  table_name: string;
  column_name: string;
}
interface PrismaLike {
  order: {
    findUnique(args: {
      where: { order_number: number };
      include: { items: true };
    }): Promise<OrderRow | null>;
    findFirst(args: { where: { buyer_name: string } }): Promise<{ id: string } | null>;
  };
  $queryRawUnsafe<T>(query: string): Promise<T>;
  $disconnect(): Promise<void>;
}

const prisma = new PrismaClient();
AfterAll(async () => {
  await prisma.$disconnect();
});

/**
 * `LEGAL_TERMS_VERSION` que la API tiene efectivamente configurada — no un
 * literal duplicado a mano (`env.validation.ts` T0.2 default): SC-008-N3 debe
 * fallar si algún día diverge, no confirmar un número que este archivo inventó.
 */
const LEGAL_TERMS_VERSION = process.env.LEGAL_TERMS_VERSION ?? '2026-06-15';

/** Los tiempos de red de la suite justifican un timeout mayor al default de 5s. */
const PASO = { timeout: 60_000 };

interface Estado {
  seed: SeedCarrito;
  invitado: Invitado;
  slugs: [string, string];
  /** Stock de cada slug del Antecedentes, leído justo después de armar el carrito. */
  stockAntes: Record<string, number>;
  /** Última respuesta de `POST /v1/checkout`. */
  ultima?: { status: number; body: unknown };
  /** Orden leída de Postgres tras un checkout exitoso (H2/N1/N3/X1). */
  ordenDb?: OrderRow;
  /** Marca de tiempo tomada justo antes de confirmar (N3). */
  antesDeConfirmar?: number;
  /** `buyer.name` del último intento rechazado, para SC-008-A1/A3. */
  buyerIntentado?: string;
  /** Slug del producto despublicado en vuelo (SC-008-A5). */
  productoDespublicado?: string;
  /** Producto de precio conocido para SC-008-X1. */
  productoPrecio?: ProductoSembrado;
}

function est(w: CatalogWorld): Estado {
  return w.state as unknown as Estado;
}

function productoPorSlug(seed: SeedCarrito, slug: string): ProductoSembrado {
  const candidatos: ProductoSembrado[] = [
    seed.stockTres,
    seed.mixtoA,
    seed.mixtoB,
    seed.paraDespublicar,
    seed.paraCambiarPrecio,
    seed.draft,
    seed.archivado,
  ];
  const p = candidatos.find((c) => c.slug === slug);
  assert.ok(p, `el seed no tiene un producto con slug ${slug}`);
  return p!;
}

async function stockDe(w: CatalogWorld, productId: string): Promise<number> {
  const dto = await apiCall<{ stock: number }>(`/v1/admin/products/${productId}`, 'GET', w.token);
  return dto.stock;
}

async function assertStockSinCambios(w: CatalogWorld): Promise<void> {
  const e = est(w);
  for (const slug of e.slugs) {
    const producto = productoPorSlug(e.seed, slug);
    const actual = await stockDe(w, producto.id);
    assert.equal(actual, e.stockAntes[slug], `el stock de ${slug} cambió (era ${e.stockAntes[slug]}, ahora ${actual})`);
  }
}

/** Checkout válido (buyer + consent + fulfillment por defecto) contra el invitado dado. */
async function ejecutarCheckoutValido(w: CatalogWorld, invitado: Invitado): Promise<void> {
  const e = est(w);
  e.antesDeConfirmar = Date.now();
  e.ultima = await invitado.checkout(buildCheckoutBody());
  if (e.ultima.status === 201) {
    const resp = e.ultima.body as CheckoutCreated;
    e.ordenDb = await prisma.order.findUnique({
      where: { order_number: resp.order_number },
      include: { items: true },
    });
    assert.ok(e.ordenDb, `la orden #${resp.order_number} no aparece en Postgres tras el 201`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Antecedentes
// ─────────────────────────────────────────────────────────────────────────────

// "Dado un catálogo sembrado con productos disponibles" NO se registra acá: ya
// existe como no-op en `pago-manual.steps.ts` (el catálogo real se siembra
// junto con el carrito en el próximo paso, vía `seedCheckoutConCarrito`).
// Redefinirlo produciría una ambigüedad de step entre archivos.

Given('un invitado con un carrito con {int} productos', PASO, async function (
  this: CatalogWorld,
  cantidad: number,
) {
  assert.equal(cantidad, 2, 'este Antecedentes sólo arma carritos de 2 productos');
  const { seed, invitado, slugs } = await seedCheckoutConCarrito();
  const e = est(this);
  e.seed = seed;
  e.invitado = invitado;
  e.slugs = slugs;
  e.stockAntes = {};
  for (const slug of slugs) {
    e.stockAntes[slug] = await stockDe(this, productoPorSlug(seed, slug).id);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// SC-008-H1 — checkout válido crea la orden
// ─────────────────────────────────────────────────────────────────────────────

When('el cliente completa nombre, email y teléfono válidos', function (this: CatalogWorld) {
  // No-op documental: el body completo (buyer + consent + fulfillment) se arma
  // y se envía en el próximo paso — separarlo en dos oraciones documenta el
  // flujo del formulario sin hacer dos llamadas.
});

When('acepta los términos y confirma retiro en sucursal', PASO, async function (
  this: CatalogWorld,
) {
  await ejecutarCheckoutValido(this, est(this).invitado);
});

Then('recibe 201 con order_token y order_number ≥ 1000', function (this: CatalogWorld) {
  const e = est(this);
  assert.equal(e.ultima?.status, 201, `se esperaba 201, llegó ${e.ultima?.status}`);
  const body = e.ultima?.body as CheckoutCreated;
  assert.match(body.order_token, /^[0-9a-f]{64}$/, 'order_token no es hex de 64 caracteres');
  assert.ok(body.order_number >= 1000, `order_number ${body.order_number} < 1000`);
});

Then('la orden en base tiene status {string}', function (this: CatalogWorld, estado: string) {
  assert.equal(est(this).ordenDb?.status, estado);
});

Then('el stock de los productos no se modificó', PASO, async function (this: CatalogWorld) {
  await assertStockSinCambios(this);
});

// ─────────────────────────────────────────────────────────────────────────────
// SC-008-H2 — ítems con precio al momento / SC-008-N3 — consentimiento trazable
// ─────────────────────────────────────────────────────────────────────────────

When('el checkout se confirma exitosamente', PASO, async function (this: CatalogWorld) {
  await ejecutarCheckoutValido(this, est(this).invitado);
  assert.equal(est(this).ultima?.status, 201, `el checkout no confirmó: ${est(this).ultima?.status}`);
});

Then('cada order_item tiene el unit_price_ars_cents vigente al crear', function (
  this: CatalogWorld,
) {
  const e = est(this);
  for (const item of e.ordenDb!.items) {
    const producto = [e.seed.mixtoA, e.seed.mixtoB].find((p) => p.id === item.product_id);
    assert.ok(producto, `order_item con product_id ${item.product_id} no matchea ningún producto sembrado`);
    assert.equal(item.unit_price_ars_cents, producto!.price_ars_cents);
  }
});

Then(
  'el total_ars_cents es la suma de \\(quantity × unit_price\\) de sus líneas',
  function (this: CatalogWorld) {
    const e = est(this);
    const suma = e.ordenDb!.items.reduce(
      (acc, item) => acc + item.quantity * item.unit_price_ars_cents,
      0,
    );
    assert.equal(e.ordenDb!.total_ars_cents, suma);
  },
);

Then('la orden tiene consent_accepted = true', function (this: CatalogWorld) {
  assert.equal(est(this).ordenDb?.consent_accepted, true);
});

Then('consent_accepted_at dentro de los 5s del request', function (this: CatalogWorld) {
  const e = est(this);
  const ts = new Date(e.ordenDb!.consent_accepted_at).getTime();
  assert.ok(
    ts >= e.antesDeConfirmar! && ts < e.antesDeConfirmar! + 5000,
    `consent_accepted_at fuera de rango: ${e.ordenDb!.consent_accepted_at}`,
  );
});

Then('consent_terms_version igual a LEGAL_TERMS_VERSION del entorno', function (
  this: CatalogWorld,
) {
  assert.equal(est(this).ordenDb?.consent_terms_version, LEGAL_TERMS_VERSION);
});

// ─────────────────────────────────────────────────────────────────────────────
// SC-008-A1/A2 — validación de datos del comprador
// ─────────────────────────────────────────────────────────────────────────────

When('el cliente envía email vacío', PASO, async function (this: CatalogWorld) {
  const e = est(this);
  const body = buildCheckoutBody({ buyer: { ...buildBuyerData(), email: '' } });
  e.buyerIntentado = body.buyer.name;
  e.ultima = await e.invitado.checkout(body);
});

Then('recibe 422 con error que nombra el campo {string}', function (
  this: CatalogWorld,
  campo: string,
) {
  const e = est(this);
  assert.equal(e.ultima?.status, 422, `se esperaba 422, llegó ${e.ultima?.status}`);
  const errores = (e.ultima?.body as { errors?: Array<{ message: string }> } | undefined)?.errors;
  assert.ok(
    errores?.some((err) => err.message.includes(campo)),
    `ningún error nombra "${campo}": ${JSON.stringify(errores)}`,
  );
});

Then('no se crea ninguna orden', PASO, async function (this: CatalogWorld) {
  const e = est(this);
  const encontrada = await prisma.order.findFirst({ where: { buyer_name: e.buyerIntentado! } });
  assert.equal(encontrada, null, `se encontró una orden con buyer_name="${e.buyerIntentado}"`);
});

When('el cliente envía {word} con valor {string}', PASO, async function (
  this: CatalogWorld,
  campo: string,
  valor: string,
) {
  const e = est(this);
  const body = buildCheckoutBody();
  (body.buyer as unknown as Record<string, string>)[campo] = valor;
  e.ultima = await e.invitado.checkout(body);
});

Then('recibe 422 con error que nombra {string}', function (this: CatalogWorld, campo: string) {
  const e = est(this);
  assert.equal(e.ultima?.status, 422, `se esperaba 422, llegó ${e.ultima?.status}`);
  const errores = (e.ultima?.body as { errors?: Array<{ message: string }> } | undefined)?.errors;
  assert.ok(
    errores?.some((err) => err.message.includes(campo)),
    `ningún error nombra "${campo}": ${JSON.stringify(errores)}`,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// SC-008-A3 — consentimiento no aceptado
// ─────────────────────────────────────────────────────────────────────────────

When('el cliente envía consent: false', PASO, async function (this: CatalogWorld) {
  const e = est(this);
  const body = buildCheckoutBody({ consent: false });
  e.buyerIntentado = body.buyer.name;
  e.ultima = await e.invitado.checkout(body);
});

// "Entonces recibe 422" (sin calificar) reusa `recibe {int}` — ya registrado
// globalmente por `pago-manual.steps.ts`; una definición propia acá sería
// ambigua contra esa (misma razón que "recibe 403" de SC-008-X2 más abajo).

// ─────────────────────────────────────────────────────────────────────────────
// SC-008-N1 — el checkout no descuenta stock antes del pago
// ─────────────────────────────────────────────────────────────────────────────

When('el checkout se confirma y la orden queda en pending_payment', PASO, async function (
  this: CatalogWorld,
) {
  await ejecutarCheckoutValido(this, est(this).invitado);
  assert.equal(est(this).ultima?.status, 201, `el checkout no confirmó: ${est(this).ultima?.status}`);
});

Then(
  'el stock de cada producto en la orden es idéntico al de antes del checkout',
  PASO,
  async function (this: CatalogWorld) {
    await assertStockSinCambios(this);
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// SC-008-A4 — carrito vacío
// ─────────────────────────────────────────────────────────────────────────────

Given('un invitado con un carrito vacío', PASO, async function (this: CatalogWorld) {
  est(this).invitado = await nuevoInvitado();
});

When('intenta hacer checkout', PASO, async function (this: CatalogWorld) {
  const e = est(this);
  e.ultima = await e.invitado.checkout(buildCheckoutBody());
});

Then('recibe 409 con código {string}', function (this: CatalogWorld, codigo: string) {
  const e = est(this);
  assert.equal(e.ultima?.status, 409, `se esperaba 409, llegó ${e.ultima?.status}`);
  const body = e.ultima?.body as { type?: string } | undefined;
  assert.equal(body?.type, codigo);
});

// ─────────────────────────────────────────────────────────────────────────────
// SC-008-A5 — producto despublicado en vuelo
// ─────────────────────────────────────────────────────────────────────────────

Given('un invitado con un carrito con un producto que se despublicó', PASO, async function (
  this: CatalogWorld,
) {
  const e = est(this);
  const invitado = await nuevoInvitado();
  const producto = e.seed.paraDespublicar;
  const alta = await invitado.fijar(producto.slug, 1);
  assert.equal(alta.status, 200, `no se pudo agregar ${producto.slug} al carrito: ${alta.status}`);
  await apiCall(`/v1/admin/products/${producto.id}`, 'PATCH', this.token, { status: 'archived' });
  e.invitado = invitado;
  e.productoDespublicado = producto.slug;
});

Then('el error nombra el slug del producto problemático', function (this: CatalogWorld) {
  const e = est(this);
  const body = e.ultima?.body as { errors?: Array<{ field: string }> } | undefined;
  assert.ok(
    body?.errors?.some((err) => err.field === e.productoDespublicado),
    `ningún error nombra el slug "${e.productoDespublicado}": ${JSON.stringify(body?.errors)}`,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// SC-008-N2 — sin datos de tarjeta
// ─────────────────────────────────────────────────────────────────────────────

When('el cliente manda un body con un campo {string}', PASO, async function (
  this: CatalogWorld,
  campo: string,
) {
  const e = est(this);
  e.ultima = await e.invitado.checkout(buildCheckoutBody(), {
    extra: { [campo]: '4111111111111111' },
  });
});

Then('recibe 422 \\(campo no permitido\\)', function (this: CatalogWorld) {
  assert.equal(est(this).ultima?.status, 422, `se esperaba 422, llegó ${est(this).ultima?.status}`);
});

Then('las tablas orders y order_items no tienen columnas de tarjeta', PASO, async function (
  this: CatalogWorld,
) {
  const columnas = await prisma.$queryRawUnsafe<ColumnRow[]>(
    `SELECT table_name, column_name FROM information_schema.columns WHERE table_name IN ('orders','order_items')`,
  );
  const sospechosa = /card|pan|cvv|cvc|holder|expiry|exp_month|exp_year|tarjeta/i;
  const encontradas = columnas.filter((c) => sospechosa.test(c.column_name));
  assert.equal(
    encontradas.length,
    0,
    `columnas sospechosas de datos de tarjeta: ${JSON.stringify(encontradas)}`,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// SC-008-X1 — el precio vigente al checkout, no el del carrito
// ─────────────────────────────────────────────────────────────────────────────

Given('un invitado con un producto en su carrito a $1000', PASO, async function (
  this: CatalogWorld,
) {
  const e = est(this);
  const producto = e.seed.paraCambiarPrecio;
  assert.equal(producto.price_ars_cents, 100000, 'el fixture paraCambiarPrecio no está en $1000');
  const invitado = await nuevoInvitado();
  const alta = await invitado.fijar(producto.slug, 1);
  assert.equal(alta.status, 200, `no se pudo agregar ${producto.slug} al carrito: ${alta.status}`);
  e.invitado = invitado;
  e.productoPrecio = producto;
});

When('el dueño sube el precio a $2000 después', PASO, async function (this: CatalogWorld) {
  const e = est(this);
  await apiCall(`/v1/admin/products/${e.productoPrecio!.id}`, 'PATCH', this.token, {
    price_ars_cents: 200000,
  });
});

When('el cliente hace checkout', PASO, async function (this: CatalogWorld) {
  await ejecutarCheckoutValido(this, est(this).invitado);
});

Then(
  'la orden registra el precio VIGENTE al momento del checkout \\(el nuevo\\)',
  function (this: CatalogWorld) {
    const e = est(this);
    const item = e.ordenDb!.items.find((i) => i.product_id === e.productoPrecio!.id);
    assert.ok(item, 'la orden no tiene línea del producto de precio cambiado');
    assert.equal(item!.unit_price_ars_cents, 200000);
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// SC-008-X2 — CSRF obligatorio
// ─────────────────────────────────────────────────────────────────────────────

When('el cliente envía el checkout sin el header X-CSRF-Token', PASO, async function (
  this: CatalogWorld,
) {
  const e = est(this);
  e.ultima = await e.invitado.checkout(buildCheckoutBody(), { conCsrf: false });
});

// "Entonces recibe 403" reusa `recibe {int}` (pago-manual.steps.ts) — ver la
// nota de SC-008-A3 más arriba.
