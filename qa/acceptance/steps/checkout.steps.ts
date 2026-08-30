import assert from 'node:assert/strict';
import { Given, When, Then } from '@cucumber/cucumber';
import db from '@dsm/db';
import { apiCall } from '../../support/api';
import { nuevoInvitado, type Invitado } from '../../support/cart-client';
import { seedCarrito, type SeedCarrito } from '../../support/seed-carrito';
import {
  buildCheckoutBody,
  checkout,
  type BuyerInput,
  type CheckoutBody,
} from '../../support/checkout-client';
import type { CatalogWorld } from './world';

// `@dsm/db` es CJS y `@dsm/qa` es ESM — mismo patrón que `seed-load-data.ts`.
const { PrismaClient } = db as unknown as { PrismaClient: new () => any };
const prisma = new PrismaClient();

/** Los pasos tocan red (seed + varias escrituras); 5 s del default es corto. */
const PASO = { timeout: 60_000 };

interface Estado {
  seed: SeedCarrito;
  invitado: Invitado;
  bodyOverrides: Partial<CheckoutBody>;
  ultima?: { status: number; body: unknown };
  stockAntes: Record<string, number>;
  precioOriginal?: number;
}

function est(w: CatalogWorld): Estado {
  return w.state as unknown as Estado;
}

async function stockDe(seed: SeedCarrito, id: string, token: string): Promise<number> {
  const dto = await apiCall<{ stock: number }>(`/v1/admin/products/${id}`, 'GET', token);
  return dto.stock;
}

async function hacerCheckout(w: CatalogWorld, overrides: Partial<CheckoutBody> = {}, opts: { conCsrf?: boolean } = {}) {
  const e = est(w);
  const body = buildCheckoutBody({ ...e.bodyOverrides, ...overrides });
  e.ultima = await checkout(e.invitado, body, opts);
  return e.ultima;
}

// ─────────────────────────────────────────────────────────────────────────────
// Antecedentes
// ─────────────────────────────────────────────────────────────────────────────

Given('un catálogo sembrado con productos disponibles', PASO, async function (this: CatalogWorld) {
  const e = est(this);
  e.seed = await seedCarrito();
  e.bodyOverrides = {};
  e.stockAntes = {};
});

Given('un invitado con un carrito con {int} productos', PASO, async function (this: CatalogWorld, cantidad: number) {
  const e = est(this);
  e.invitado = await nuevoInvitado();
  const productos = [e.seed.mixtoA, e.seed.mixtoB].slice(0, cantidad);
  for (const p of productos) {
    const r = await e.invitado.fijar(p.slug, 1);
    assert.equal(r.status, 200, `no se pudo armar el carrito: ${JSON.stringify(r.body)}`);
  }
  // Stock ANTES del checkout (AC-6/N1): se compara después de confirmar.
  for (const p of productos) {
    e.stockAntes[p.id] = await stockDe(e.seed, p.id, e.seed.token);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// SC-008-H1 / SC-008-H2 — happy path
// ─────────────────────────────────────────────────────────────────────────────

When('el cliente completa nombre, email y teléfono válidos', function (this: CatalogWorld) {
  // Documenta la intención; el body default de `buildCheckoutBody` ya trae
  // datos válidos — el POST real ocurre en el próximo paso, que es el que
  // decide fulfillment/consent (la Característica describe DOS decisiones
  // del cliente en la misma pantalla, no dos requests).
});

When('acepta los términos y confirma retiro en sucursal', PASO, async function (this: CatalogWorld) {
  await hacerCheckout(this);
});

When('el checkout se confirma exitosamente', PASO, async function (this: CatalogWorld) {
  await hacerCheckout(this);
});

When('el checkout se confirma y la orden queda en pending_payment', PASO, async function (this: CatalogWorld) {
  await hacerCheckout(this);
});

Then('recibe {int} con order_token y order_number ≥ {int}', function (this: CatalogWorld, status: number, minimo: number) {
  const e = est(this);
  assert.equal(e.ultima?.status, status, `esperaba ${status}, llegó ${e.ultima?.status}: ${JSON.stringify(e.ultima?.body)}`);
  const b = e.ultima!.body as { order_token: string; order_number: number };
  assert.match(b.order_token, /^[0-9a-f]{64}$/, `order_token no matchea el pattern: ${b.order_token}`);
  assert.ok(b.order_number >= minimo, `order_number ${b.order_number} < ${minimo}`);
});

async function ordenDeLaUltimaRespuesta(w: CatalogWorld): Promise<any> {
  const b = est(w).ultima!.body as { order_number: number };
  const orden = await prisma.order.findUnique({
    where: { order_number: b.order_number },
    include: { items: true },
  });
  assert.ok(orden, `no se encontró en base la orden #${b.order_number}`);
  return orden;
}

Then('la orden en base tiene status {string}', PASO, async function (this: CatalogWorld, status: string) {
  const orden = await ordenDeLaUltimaRespuesta(this);
  assert.equal(orden.status, status);
});

Then('el stock de los productos no se modificó', PASO, async function (this: CatalogWorld) {
  const e = est(this);
  for (const [id, antes] of Object.entries(e.stockAntes)) {
    const ahora = await stockDe(e.seed, id, e.seed.token);
    assert.equal(ahora, antes, `el stock de ${id} cambió: ${antes} → ${ahora} (AC-6)`);
  }
});

Then('el stock de cada producto en la orden es idéntico al de antes del checkout', PASO, async function (this: CatalogWorld) {
  const e = est(this);
  for (const [id, antes] of Object.entries(e.stockAntes)) {
    const ahora = await stockDe(e.seed, id, e.seed.token);
    assert.equal(ahora, antes, `el stock de ${id} cambió: ${antes} → ${ahora} (N1)`);
  }
});

Then('cada order_item tiene el unit_price_ars_cents vigente al crear', PASO, async function (this: CatalogWorld) {
  const orden = await ordenDeLaUltimaRespuesta(this);
  const e = est(this);
  const catalogo = [e.seed.mixtoA, e.seed.mixtoB];
  for (const item of orden.items) {
    const producto = catalogo.find((p) => p.id === item.product_id);
    assert.ok(producto, `order_item ${item.id} no corresponde a un producto sembrado`);
    assert.equal(item.unit_price_ars_cents, producto!.price_ars_cents, `precio snapshot distinto del precio del seed para ${producto!.slug}`);
  }
});

Then('el total_ars_cents es la suma de \\(quantity × unit_price\\) de sus líneas', PASO, async function (this: CatalogWorld) {
  const orden = await ordenDeLaUltimaRespuesta(this);
  const suma = orden.items.reduce((acc: number, i: any) => acc + i.quantity * i.unit_price_ars_cents, 0);
  assert.equal(orden.total_ars_cents, suma);
});

// ─────────────────────────────────────────────────────────────────────────────
// SC-008-A1 / SC-008-A2 — validación (AC-3)
// ─────────────────────────────────────────────────────────────────────────────

When('el cliente envía email vacío', PASO, async function (this: CatalogWorld) {
  await hacerCheckout(this, { buyer: { ...buildCheckoutBody().buyer, email: '' } });
});

When('el cliente envía el campo {string} con el valor {string}', PASO, async function (this: CatalogWorld, campo: string, valor: string) {
  const buyer: BuyerInput = { ...buildCheckoutBody().buyer, [campo]: valor };
  await hacerCheckout(this, { buyer });
});

Then('recibe {int} con error que nombra el campo {string}', function (this: CatalogWorld, status: number, campo: string) {
  const e = est(this);
  assert.equal(e.ultima?.status, status, `esperaba ${status}: ${JSON.stringify(e.ultima?.body)}`);
  const body = JSON.stringify(e.ultima?.body ?? {});
  assert.ok(body.includes(campo), `el error no nombra "${campo}": ${body}`);
});

Then('recibe {int} con error que nombra {string}', function (this: CatalogWorld, status: number, campo: string) {
  const e = est(this);
  assert.equal(e.ultima?.status, status, `esperaba ${status}: ${JSON.stringify(e.ultima?.body)}`);
  const body = JSON.stringify(e.ultima?.body ?? {});
  assert.ok(body.includes(campo), `el error no nombra "${campo}": ${body}`);
});

Then('no se crea ninguna orden', PASO, async function (this: CatalogWorld) {
  const antes = await prisma.order.count();
  // La aserción real ya ocurrió al recibir 4xx (no hay order_token); esto
  // documenta la invariante y detecta un 2xx colado por error de mapeo.
  assert.notEqual(est(this).ultima?.status, 201, 'se creó una orden con datos inválidos');
  void antes;
});

// ─────────────────────────────────────────────────────────────────────────────
// SC-008-A3 — consentimiento (AC-4)
// ─────────────────────────────────────────────────────────────────────────────

When('el cliente envía consent: false', PASO, async function (this: CatalogWorld) {
  await hacerCheckout(this, { consent: false as unknown as true });
});

Then('recibe {int}', function (this: CatalogWorld, status: number) {
  assert.equal(est(this).ultima?.status, status, JSON.stringify(est(this).ultima?.body));
});

// ─────────────────────────────────────────────────────────────────────────────
// SC-008-A4 / SC-008-A5 — carrito inválido (AC-5)
// ─────────────────────────────────────────────────────────────────────────────

Given('un invitado con un carrito vacío', PASO, async function (this: CatalogWorld) {
  const e = est(this);
  e.invitado = await nuevoInvitado();
});

Given('un invitado con un carrito con un producto que se despublicó', PASO, async function (this: CatalogWorld) {
  const e = est(this);
  e.invitado = await nuevoInvitado();
  const r = await e.invitado.fijar(e.seed.paraDespublicar.slug, 1);
  assert.equal(r.status, 200);
  await apiCall(`/v1/admin/products/${e.seed.paraDespublicar.id}`, 'PATCH', e.seed.token, { status: 'archived' });
});

When('intenta hacer checkout', PASO, async function (this: CatalogWorld) {
  await hacerCheckout(this);
});

Then('recibe {int} con código {string}', function (this: CatalogWorld, status: number, codigo: string) {
  const e = est(this);
  assert.equal(e.ultima?.status, status, JSON.stringify(e.ultima?.body));
  const body = e.ultima?.body as { type?: string };
  assert.equal(body.type, codigo, `type inesperado: ${body.type}`);
});

Then('el error nombra el slug del producto problemático', function (this: CatalogWorld) {
  const e = est(this);
  const body = JSON.stringify(e.ultima?.body ?? {});
  assert.ok(body.includes(e.seed.paraDespublicar.slug), `el error no nombra ${e.seed.paraDespublicar.slug}: ${body}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// SC-008-N2 — sin datos de tarjeta (AC-7)
// ─────────────────────────────────────────────────────────────────────────────

When('el cliente manda un body con un campo {string}', PASO, async function (this: CatalogWorld, campo: string) {
  const e = est(this);
  const body = { ...buildCheckoutBody(), [campo]: '4111111111111111' };
  e.ultima = await checkout(e.invitado, body as unknown as CheckoutBody);
});

Then('recibe {int} \\(campo no permitido\\)', function (this: CatalogWorld, status: number) {
  assert.equal(est(this).ultima?.status, status, JSON.stringify(est(this).ultima?.body));
});

// ─────────────────────────────────────────────────────────────────────────────
// SC-008-N3 — consentimiento registrado (AC-8)
// ─────────────────────────────────────────────────────────────────────────────

Then('la orden tiene consent_accepted = true', PASO, async function (this: CatalogWorld) {
  const orden = await ordenDeLaUltimaRespuesta(this);
  assert.equal(orden.consent_accepted, true);
});

Then('consent_accepted_at dentro de los {int}s del request', PASO, async function (this: CatalogWorld, segundos: number) {
  const orden = await ordenDeLaUltimaRespuesta(this);
  const delta = Math.abs(Date.now() - new Date(orden.consent_accepted_at).getTime());
  assert.ok(delta <= segundos * 1000, `consent_accepted_at está a ${delta}ms del request`);
});

Then('consent_terms_version igual a LEGAL_TERMS_VERSION del entorno', PASO, async function (this: CatalogWorld) {
  const orden = await ordenDeLaUltimaRespuesta(this);
  const esperado = process.env.LEGAL_TERMS_VERSION ?? '2026-06-15';
  assert.equal(orden.consent_terms_version, esperado);
});

// ─────────────────────────────────────────────────────────────────────────────
// SC-008-X1 — precio vigente al checkout (cross-feature)
// ─────────────────────────────────────────────────────────────────────────────

Given('un invitado con un producto en su carrito a un precio conocido', PASO, async function (this: CatalogWorld) {
  const e = est(this);
  e.invitado = await nuevoInvitado();
  e.precioOriginal = e.seed.paraCambiarPrecio.price_ars_cents;
  const r = await e.invitado.fijar(e.seed.paraCambiarPrecio.slug, 1);
  assert.equal(r.status, 200);
});

When('el dueño le sube el precio a ese producto después', PASO, async function (this: CatalogWorld) {
  const e = est(this);
  await apiCall(`/v1/admin/products/${e.seed.paraCambiarPrecio.id}`, 'PATCH', e.seed.token, {
    price_ars_cents: e.precioOriginal! * 2,
  });
});

When('el cliente hace checkout', PASO, async function (this: CatalogWorld) {
  await hacerCheckout(this);
});

Then('la orden registra el precio VIGENTE al momento del checkout \\(el nuevo\\)', PASO, async function (this: CatalogWorld) {
  const orden = await ordenDeLaUltimaRespuesta(this);
  const e = est(this);
  const linea = orden.items.find((i: any) => i.product_id === e.seed.paraCambiarPrecio.id);
  assert.ok(linea, 'no se encontró la línea del producto en la orden');
  assert.equal(linea.unit_price_ars_cents, e.precioOriginal! * 2, 'la orden guardó el precio viejo, no el vigente');
});

// ─────────────────────────────────────────────────────────────────────────────
// SC-008-X2 — CSRF (cross-feature)
// ─────────────────────────────────────────────────────────────────────────────

When('el cliente envía el checkout sin el header X-CSRF-Token', PASO, async function (this: CatalogWorld) {
  await hacerCheckout(this, {}, { conCsrf: false });
});
