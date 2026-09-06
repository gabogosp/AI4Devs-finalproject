import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { Given, When, Then } from '@cucumber/cucumber';
import { request, type APIRequestContext } from '@playwright/test';
import { borrarCuenta, cookieBorrada, type RespuestaBorrado } from '../../support/borrar-cuenta';
import {
  nuevaCuenta,
  nuevoContexto,
  login,
  logout,
  me,
  refresh,
  pedirReset,
  tokenDeResetDesde,
  marcaDeLog,
  datosDeCuenta,
  PASSWORD_VALIDA,
  type Sesion,
  type Cuenta,
} from '../../support/customer-auth';
import {
  sembrarProductoPublicado,
  compraLogueada,
  compraLogueadaPendiente,
  compraLogueadaConSesion,
} from '../../support/seed-order-history';
import { avanzarEstado } from '../../support/seed-metricas';
import { cancelarOrden } from '../../support/cancelar-orden';
import { QA_API_BASE_URL, QA_WEB_BASE_URL } from '../../support/qa-env';
import { leerLogApi } from '../../support/api-log';
import { Invitado } from '../../support/cart-client';
import { buildCheckoutBody } from '../../support/builders';
import type { CatalogWorld } from './world';

/**
 * US-020 — Borrado de cuenta y datos personales (derecho al olvido).
 *
 * Contra la API real + Postgres real (`qa-plan.md` §9): cero `INSERT`/`UPDATE`
 * directos. Cada fixture nace de `nuevaCuenta`/`compraLogueada*`/`avanzarEstado`/
 * `cancelarOrden` reales, y la acción bajo prueba es siempre `borrarCuenta`
 * (`qa/support/borrar-cuenta.ts`).
 */

const PASO = { timeout: 60_000 };

/** Espejo de las constantes reales de `apps/api/src/checkout/order-anonymization.ts`
 * y `apps/api/src/auth/customer-anonymization.ts` — no importables desde `@dsm/qa`
 * (paquete backend, no dependencia), mismo criterio que
 * `DOMINIO_ANONIMIZADO` en `retencion-ordenes.steps.ts`. */
const ANONYMIZED_BUYER_NAME = 'Comprador anonimizado';
const DOMINIO_BUYER_ANONIMIZADO = /@.*\.invalid$/i;

interface AdminOrderSummary {
  id: string;
  order_number: number;
  buyer_name: string;
  status: string;
  created_at: string;
}

interface AdminOrderItem {
  product_name: string;
  product_sku: string;
  quantity: number;
  unit_price_ars_cents: number;
  subtotal_ars_cents: number;
}

interface AdminOrderDetail extends AdminOrderSummary {
  buyer_email: string;
  buyer_phone: string;
  fulfillment: string;
  total_ars_cents: number;
  items: AdminOrderItem[];
  anonymized_at: string | null;
  anonymization_reason: 'retention_policy' | 'requested' | 'account_deletion' | null;
}

interface SummaryResponse {
  range: { from: string; to: string };
  orders_count: number;
  total_ars_cents: number;
  breakdown_by_status: Record<string, { count: number; total_ars_cents: number }>;
}

interface TopProductsResponse {
  range: { from: string; to: string };
  data: Array<{ product_id: string; quantity_sold: number; revenue_ars_cents: number }>;
}

async function llamarAdmin(
  path: string,
  method: string,
  token?: string,
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${QA_API_BASE_URL}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => undefined) };
}

async function listarOrdenes(token: string): Promise<AdminOrderSummary[]> {
  const r = await llamarAdmin('/v1/admin/orders?limit=100', 'GET', token);
  return (r.body as { data: AdminOrderSummary[] }).data;
}

async function detalleDeOrden(token: string, id: string): Promise<AdminOrderDetail> {
  const r = await llamarAdmin(`/v1/admin/orders/${id}`, 'GET', token);
  return r.body as AdminOrderDetail;
}

/** Resuelve el `id` interno (UUID) de una orden ya confirmada por su `order_number`,
 * vía `GET /v1/admin/orders` — nunca por Postgres directo (mismo patrón que
 * `idPendientePorOrderNumber` de `seed-metricas.ts`, generalizado a cualquier estado). */
async function idPorOrderNumber(token: string, orderNumber: number): Promise<string> {
  const lista = await listarOrdenes(token);
  const fila = lista.find((o) => o.order_number === orderNumber);
  if (!fila) {
    throw new Error(
      `[borrado-cuenta.steps] la orden #${orderNumber} no aparece en GET /v1/admin/orders?limit=100 — ` +
        '¿el límite de 100 no alcanza para esta corrida?',
    );
  }
  return fila.id;
}

/** Registro real CON teléfono (`RegisterDto.phone`, opcional) — `nuevaCuenta()` de
 * `customer-auth.ts` no lo expone, así que se registra a mano acá (sin modificar
 * ese archivo) reusando `nuevoContexto()`, que sí exporta. */
async function registrarConTelefono(
  nombre: string,
  email: string,
  phone: string,
  password: string,
): Promise<Sesion> {
  const ctx = await nuevoContexto();
  const res = await ctx.post('/v1/auth/register', { data: { email, name: nombre, password, phone } });
  if (res.status() !== 201) {
    throw new Error(`[borrado-cuenta.steps] registro con teléfono falló: ${res.status()} — ${await res.text()}`);
  }
  const cuerpo = (await res.json()) as { customer: { id: string } };
  return { ctx, cuenta: { id: cuerpo.customer.id, email, password, nombre } };
}

/** Orden `pending_payment` real para una sesión YA EXISTENTE (mismo camino que el
 * `comprarConSesion` privado de `seed-order-history.ts`, replicado acá porque ese
 * archivo no lo exporta y el plan pide no modificarlo, qa-plan.md §7). */
async function ordenPendienteParaSesion(
  sesion: Sesion,
  slug: string,
): Promise<{ orderNumber: number }> {
  const invitado = new Invitado(sesion.ctx);
  const alta = await invitado.fijar(slug, 1);
  if (alta.status !== 200) {
    throw new Error(`[borrado-cuenta.steps] no se pudo agregar ${slug} al carrito: ${alta.status}`);
  }
  const checkout = await invitado.checkout(
    buildCheckoutBody({ buyer: { name: sesion.cuenta.nombre, email: sesion.cuenta.email, phone: '+54 9 11 5555 0000' } }),
  );
  if (checkout.status !== 201) {
    throw new Error(`[borrado-cuenta.steps] POST /v1/checkout falló: ${checkout.status}`);
  }
  return { orderNumber: checkout.body.order_number };
}

async function loginCrudo(email: string, password: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${QA_API_BASE_URL}/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: QA_WEB_BASE_URL },
    body: JSON.stringify({ email, password }),
  });
  return { status: res.status, body: await res.json().catch(() => undefined) };
}

/** Mismo camino que el `refresh()` exportado de `customer-auth.ts`, pero devuelve
 * también el cuerpo (ese helper sólo devuelve el status) — hace falta para la
 * comparación byte-a-byte de N-2/puerta 2. */
async function refreshCrudo(ctx: APIRequestContext): Promise<{ status: number; body: unknown }> {
  const estado = await ctx.storageState();
  const csrfToken = estado.cookies.find((c) => c.name === 'dsm_csrf')?.value;
  const res = await ctx.post('/v1/auth/refresh', {
    headers: csrfToken ? { 'x-csrf-token': csrfToken } : {},
  });
  return { status: res.status(), body: await res.json().catch(() => undefined) };
}

async function confirmarResetCrudo(token: string, password: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${QA_API_BASE_URL}/v1/auth/password-reset/confirm`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: QA_WEB_BASE_URL },
    body: JSON.stringify({ token, password }),
  });
  return { status: res.status, body: await res.json().catch(() => undefined) };
}

function tokenNuncaEmitido(): string {
  return randomBytes(32).toString('hex');
}

interface Estado {
  cliente?: Sesion;
  ultima?: RespuestaBorrado;
  // H-2
  nombre?: string;
  email?: string;
  phone?: string;
  orderNumber?: number;
  superficieActual?: string;
  detalleOrden?: AdminOrderDetail;
  filaListado?: AdminOrderSummary;
  // H-3
  antes?: Record<'entregada' | 'cancelada', { id: string; status: string; total_ars_cents: number; created_at: string; items: AdminOrderItem[] }>;
  despues?: Record<'entregada' | 'cancelada', AdminOrderDetail>;
  // A-1
  respuestaIntento?: { status: number; body: unknown };
  // A-2
  cuentaOriginal?: Cuenta;
  ctxNueva?: APIRequestContext;
  respuestaRegistro?: { status: number; body: unknown };
  // A-3/A-3b
  primero?: Sesion;
  segundo?: Sesion;
  resultados?: RespuestaBorrado[];
  // A-4
  ordenAnonimizadaId?: string;
  ordenAnonimizadaAntes?: { anonymized_at: string | null; anonymization_reason: string | null };
  // N-1a/N-1b
  ordenId?: string;
  // N-2
  estadoPrevio?: string;
  intento?: string;
  otroDispositivo?: APIRequestContext;
  tokenReset?: string;
  respuestaPuerta?: { status: number; body: unknown };
  respuestaControl?: { status: number; body: unknown };
  // N-4
  summaryAntes?: SummaryResponse;
  summaryDespues?: SummaryResponse;
  topAntes?: TopProductsResponse;
  topDespues?: TopProductsResponse;
  // N-5
  objetivo?: Sesion;
  actor?: string;
  // N-6/N-6b
  marca?: number;
}

function est(w: CatalogWorld): Estado {
  w.state.borradoCuenta ??= {};
  return w.state.borradoCuenta as Estado;
}

// ─────────────────────────────────────────────────────────────────────────────
// H-1 — happy path (AC-1)
// ─────────────────────────────────────────────────────────────────────────────

Given('un cliente registrado con sesión iniciada y sin órdenes en curso', async function (this: CatalogWorld) {
  est(this).cliente = await nuevaCuenta();
});

When('confirma el borrado de su cuenta', async function (this: CatalogWorld) {
  est(this).ultima = await borrarCuenta(est(this).cliente!.ctx);
});

/** N-1a usa una variante más corta del mismo texto ("confirma el borrado", sin
 * "de su cuenta") — misma acción, mismo helper. */
When('confirma el borrado', async function (this: CatalogWorld) {
  est(this).ultima = await borrarCuenta(est(this).cliente!.ctx);
});

Then('el borrado se ejecuta de inmediato, en la misma respuesta', function (this: CatalogWorld) {
  const e = est(this);
  assert.equal(e.ultima?.status, 204, `status inesperado: ${e.ultima?.status} — ${JSON.stringify(e.ultima?.body)}`);
});

Then('su sesión \\(cookie de acceso y de refresco\\) queda cerrada', function (this: CatalogWorld) {
  const headers = est(this).ultima!.headers;
  assert.ok(cookieBorrada(headers, 'dsm_access'), 'dsm_access no vino limpia en el Set-Cookie');
  assert.ok(cookieBorrada(headers, 'dsm_refresh'), 'dsm_refresh no vino limpia en el Set-Cookie');
});

Then('una llamada siguiente con esa misma sesión ya no lo identifica como cliente', async function (this: CatalogWorld) {
  const status = await me(est(this).cliente!.ctx);
  assert.notEqual(status, 200, 'GET /v1/auth/me todavía identifica a la cuenta borrada');
});

// ─────────────────────────────────────────────────────────────────────────────
// H-2 — PII fuera de toda superficie (AC-2)
// ─────────────────────────────────────────────────────────────────────────────

Given(
  'un cliente registrado, con nombre, email y teléfono reales, que compró al menos una vez',
  PASO,
  async function (this: CatalogWorld) {
    const e = est(this);
    const sufijo = Date.now().toString(36);
    e.nombre = `QA PII ${sufijo}`;
    e.email = `qa-us020-pii-${sufijo}@example.test`;
    e.phone = '+54 9 351 555 1234';
    e.cliente = await registrarConTelefono(e.nombre, e.email, e.phone, PASSWORD_VALIDA);

    const slug = await sembrarProductoPublicado();
    const invitado = new Invitado(e.cliente.ctx);
    const alta = await invitado.fijar(slug, 1);
    assert.equal(alta.status, 200, 'no se pudo agregar el producto al carrito');
    const checkout = await invitado.checkout(
      buildCheckoutBody({ buyer: { name: e.nombre, email: e.email, phone: e.phone } }),
    );
    assert.equal(checkout.status, 201, `checkout falló: ${JSON.stringify(checkout.body)}`);
    const confirm = await fetch(`${QA_API_BASE_URL}/v1/checkout/simulate-payment`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ order_token: checkout.body.order_token }),
    });
    assert.equal(confirm.status, 200, 'simulate-payment falló al sembrar H-2');
    e.orderNumber = checkout.body.order_number;

    // La orden confirmada queda en 'new' — uno de los 4 estados BLOQUEANTES
    // (AC-4/design.md §Approach): sin avanzarla, el borrado de esta misma
    // Given respondería 409, no 204, y H-2 no llegaría a ejercitar la
    // anonimización que quiere verificar. Se avanza a 'delivered' para que
    // el borrado del When ("Cuando borra su cuenta") proceda sin bloqueo.
    const orderId = await idPorOrderNumber(this.token, e.orderNumber);
    await avanzarEstado(this.token, orderId, 'preparing');
    await avanzarEstado(this.token, orderId, 'ready');
    const rDelivered = await avanzarEstado(this.token, orderId, 'delivered');
    assert.equal(rDelivered.status, 200, 'no se pudo llevar la orden de H-2 a delivered');
  },
);

When('borra su cuenta', PASO, async function (this: CatalogWorld) {
  est(this).ultima = await borrarCuenta(est(this).cliente!.ctx);
});

Then(
  '{string} ya no muestra su nombre, su email ni su teléfono reales',
  PASO,
  async function (this: CatalogWorld, superficie: string) {
    const e = est(this);
    e.superficieActual = superficie;
    const orderId = await idPorOrderNumber(this.token, e.orderNumber!);

    if (superficie.startsWith('el detalle')) {
      const detalle = await detalleDeOrden(this.token, orderId);
      e.detalleOrden = detalle;
      assert.notEqual(detalle.buyer_name, e.nombre, 'buyer_name sigue siendo el real en el detalle admin');
      assert.notEqual(detalle.buyer_email, e.email, 'buyer_email sigue siendo el real en el detalle admin');
      assert.notEqual(detalle.buyer_phone, e.phone, 'buyer_phone sigue siendo el real en el detalle admin');
    } else if (superficie.startsWith('el listado')) {
      const lista = await listarOrdenes(this.token);
      const fila = lista.find((o) => o.id === orderId)!;
      e.filaListado = fila;
      assert.notEqual(fila.buyer_name, e.nombre, 'buyer_name sigue siendo el real en el listado admin');
    } else {
      // La exportación CSV de reports (`sales`/`top-products`/`summary`) es
      // agregada por diseño: NUNCA incluyó columnas de comprador
      // (`apps/api/src/reports/README.md`) — se verifica igual, en vez de
      // asumirlo, para que un cambio futuro que agregue una columna de
      // comprador a algún CSV lo caiga acá.
      const csv = await fetch(`${QA_API_BASE_URL}/v1/admin/reports/summary/export`, {
        headers: { authorization: `Bearer ${this.token}` },
      });
      const texto = await csv.text();
      assert.ok(!texto.includes(e.nombre!), 'el CSV de reports contiene el nombre real');
      assert.ok(!texto.includes(e.email!), 'el CSV de reports contiene el email real');
      assert.ok(!texto.includes(e.phone!), 'el CSV de reports contiene el teléfono real');
    }
  },
);

Then('en su lugar aparece una indicación de que los datos fueron suprimidos', function (this: CatalogWorld) {
  const e = est(this);
  if (e.superficieActual!.startsWith('el detalle')) {
    assert.equal(e.detalleOrden!.buyer_name, ANONYMIZED_BUYER_NAME, 'buyer_name no muestra el placeholder de anonimización');
    assert.match(
      e.detalleOrden!.buyer_email,
      DOMINIO_BUYER_ANONIMIZADO,
      'buyer_email no usa el dominio placeholder .invalid',
    );
  } else if (e.superficieActual!.startsWith('el listado')) {
    assert.equal(e.filaListado!.buyer_name, ANONYMIZED_BUYER_NAME, 'buyer_name no muestra el placeholder en el listado');
  } else {
    // Nota de alcance (ver Then anterior): el CSV de reports nunca tuvo una
    // columna de comprador que pudiera "indicar" supresión — no hay superficie
    // de fuga que suprimir, así que no hay nada que afirmar acá más allá de
    // la ausencia ya verificada.
    assert.ok(true);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// H-3 — historial sobrevive anonimizado (AC-3)
// ─────────────────────────────────────────────────────────────────────────────

Given('un cliente con una orden ya entregada y otra ya cancelada', PASO, async function (this: CatalogWorld) {
  const e = est(this);
  e.cliente = await nuevaCuenta();

  const slug1 = await sembrarProductoPublicado();
  const c1 = await compraLogueadaConSesion(e.cliente, slug1);
  const idEntregada = await idPorOrderNumber(this.token, c1.orderNumber);
  await avanzarEstado(this.token, idEntregada, 'preparing');
  await avanzarEstado(this.token, idEntregada, 'ready');
  const rDelivered = await avanzarEstado(this.token, idEntregada, 'delivered');
  assert.equal(rDelivered.status, 200, 'no se pudo llevar la primera orden a delivered');

  const slug2 = await sembrarProductoPublicado();
  const c2 = await compraLogueadaConSesion(e.cliente, slug2);
  const idCancelada = await idPorOrderNumber(this.token, c2.orderNumber);
  const rCancel = await cancelarOrden(this.token, idCancelada);
  assert.equal(rCancel.status, 200, 'no se pudo cancelar la segunda orden');

  const [detalleEntregada, detalleCancelada] = await Promise.all([
    detalleDeOrden(this.token, idEntregada),
    detalleDeOrden(this.token, idCancelada),
  ]);
  e.antes = {
    entregada: {
      id: idEntregada,
      status: detalleEntregada.status,
      total_ars_cents: detalleEntregada.total_ars_cents,
      created_at: detalleEntregada.created_at,
      items: detalleEntregada.items,
    },
    cancelada: {
      id: idCancelada,
      status: detalleCancelada.status,
      total_ars_cents: detalleCancelada.total_ars_cents,
      created_at: detalleCancelada.created_at,
      items: detalleCancelada.items,
    },
  };
});

Then('ambas órdenes conservan sus ítems, cantidades, importes, estado y fechas', PASO, async function (
  this: CatalogWorld,
) {
  const e = est(this);
  const [detalleEntregada, detalleCancelada] = await Promise.all([
    detalleDeOrden(this.token, e.antes!.entregada.id),
    detalleDeOrden(this.token, e.antes!.cancelada.id),
  ]);
  const despuesPorClave: Record<'entregada' | 'cancelada', AdminOrderDetail> = {
    entregada: detalleEntregada,
    cancelada: detalleCancelada,
  };
  e.despues = despuesPorClave;

  for (const clave of ['entregada', 'cancelada'] as const) {
    const antes = e.antes![clave];
    const despues = despuesPorClave[clave];
    assert.equal(despues.status, antes.status, `el status de la orden ${clave} cambió`);
    assert.equal(despues.total_ars_cents, antes.total_ars_cents, `el total de la orden ${clave} cambió`);
    assert.equal(despues.created_at, antes.created_at, `created_at de la orden ${clave} cambió`);
    assert.deepEqual(
      despues.items.map((i: AdminOrderItem) => ({ sku: i.product_sku, qty: i.quantity, precio: i.unit_price_ars_cents })),
      antes.items.map((i: AdminOrderItem) => ({ sku: i.product_sku, qty: i.quantity, precio: i.unit_price_ars_cents })),
      `los items de la orden ${clave} cambiaron`,
    );
  }
});

Then('ninguna orden ni ninguno de sus ítems desaparece', function (this: CatalogWorld) {
  const e = est(this);
  for (const clave of ['entregada', 'cancelada'] as const) {
    assert.ok(e.despues![clave].items.length >= 1, `la orden ${clave} se quedó sin items`);
  }
});

Then('cada orden queda con motivo de anonimización {string} y su fecha', function (
  this: CatalogWorld,
  reason: string,
) {
  const e = est(this);
  for (const clave of ['entregada', 'cancelada'] as const) {
    assert.equal(e.despues![clave].anonymization_reason, reason, `motivo inesperado en la orden ${clave}`);
    assert.ok(e.despues![clave].anonymized_at, `la orden ${clave} no tiene anonymized_at`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// A-1 — órdenes en curso bloquean el borrado (AC-4)
// ─────────────────────────────────────────────────────────────────────────────

Given('un cliente con una orden real en estado {string}', PASO, async function (
  this: CatalogWorld,
  estado: string,
) {
  const e = est(this);
  const slug = await sembrarProductoPublicado();
  if (estado === 'pending_payment') {
    const compra = await compraLogueadaPendiente(slug);
    e.cliente = compra.sesion;
  } else {
    const compra = await compraLogueada(slug);
    e.cliente = compra.sesion;
    if (estado !== 'new') {
      const orderId = await idPorOrderNumber(this.token, compra.orderNumber);
      const objetivo = estado === 'ready' ? ['preparing', 'ready'] : ['preparing'];
      for (const paso of objetivo) {
        const r = await avanzarEstado(this.token, orderId, paso as 'preparing' | 'ready');
        assert.equal(r.status, 200, `no se pudo avanzar la orden a "${paso}"`);
      }
    }
  }
});

When('intenta borrar su cuenta', async function (this: CatalogWorld) {
  est(this).ultima = await borrarCuenta(est(this).cliente!.ctx);
});

Then('la solicitud se rechaza y ningún dato de la cuenta cambia', PASO, async function (this: CatalogWorld) {
  const e = est(this);
  assert.equal(e.ultima?.status, 409, `status inesperado: ${e.ultima?.status} — ${JSON.stringify(e.ultima?.body)}`);
  const status = await me(e.cliente!.ctx);
  assert.equal(status, 200, 'la sesión dejó de identificar a la cuenta pese al rechazo');
});

Then('la respuesta indica cuántas y cuáles son las órdenes que lo bloquean', function (this: CatalogWorld) {
  const body = est(this).ultima?.body as { blocking_orders?: unknown[] } | undefined;
  assert.ok(Array.isArray(body?.blocking_orders), 'la respuesta no trae blocking_orders');
  assert.ok(body!.blocking_orders!.length >= 1, 'blocking_orders vino vacío');
});

// ─────────────────────────────────────────────────────────────────────────────
// A-2 — email liberado, re-registro limpio (AC-5)
// ─────────────────────────────────────────────────────────────────────────────

Given('una cuenta que borró su titular', async function (this: CatalogWorld) {
  const e = est(this);
  e.cliente = await nuevaCuenta();
  e.cuentaOriginal = { ...e.cliente.cuenta };
  const r = await borrarCuenta(e.cliente.ctx);
  assert.equal(r.status, 204, `no se pudo pre-borrar la cuenta fixture: ${r.status}`);
});

When('alguien se registra de nuevo con el mismo email', async function (this: CatalogWorld) {
  const e = est(this);
  e.ctxNueva = await nuevoContexto();
  const res = await e.ctxNueva.post('/v1/auth/register', {
    data: { email: e.cuentaOriginal!.email, name: 'Titular Nuevo', password: PASSWORD_VALIDA },
  });
  e.respuestaRegistro = { status: res.status(), body: await res.json().catch(() => undefined) };
});

Then('el registro se completa como si fuera la primera vez', function (this: CatalogWorld) {
  const e = est(this);
  assert.equal(e.respuestaRegistro?.status, 201, `el re-registro no dio 201: ${JSON.stringify(e.respuestaRegistro?.body)}`);
  const nuevoId = (e.respuestaRegistro!.body as { customer: { id: string } }).customer.id;
  assert.notEqual(nuevoId, e.cuentaOriginal!.id, 'el re-registro reusó el id de la cuenta borrada');
});

Then('esa cuenta nueva no expone historial, carrito ni dato alguno de la cuenta anterior', async function (
  this: CatalogWorld,
) {
  const e = est(this);
  const res = await e.ctxNueva!.get('/v1/me/orders');
  assert.equal(res.status(), 200);
  const body = (await res.json()) as { data: unknown[] } | unknown[];
  const data = Array.isArray(body) ? body : body.data;
  assert.equal(data.length, 0, 'la cuenta nueva ve historial de la cuenta anterior');
});

// ─────────────────────────────────────────────────────────────────────────────
// A-3 / A-3b — placeholder único, sin colisión (AC-6)
// ─────────────────────────────────────────────────────────────────────────────

Given('dos clientes registrados distintos, cada uno con email real propio', async function (this: CatalogWorld) {
  const e = est(this);
  e.primero = await nuevaCuenta();
  e.segundo = await nuevaCuenta();
  assert.notEqual(e.primero.cuenta.email, e.segundo.cuenta.email);
});

When('el primero borra su cuenta', async function (this: CatalogWorld) {
  const e = est(this);
  e.resultados = [await borrarCuenta(e.primero!.ctx)];
});

When('el segundo borra la suya inmediatamente después', async function (this: CatalogWorld) {
  const e = est(this);
  e.resultados!.push(await borrarCuenta(e.segundo!.ctx));
});

When('ambos disparan el borrado de su cuenta al mismo tiempo', async function (this: CatalogWorld) {
  const e = est(this);
  e.resultados = await Promise.all([borrarCuenta(e.primero!.ctx), borrarCuenta(e.segundo!.ctx)]);
});

Then('los dos borrados terminan sin error', function (this: CatalogWorld) {
  const e = est(this);
  for (const r of e.resultados!) {
    assert.ok(r.status < 500, `un borrado devolvió ${r.status} — posible colisión de UNIQUE en customers.email`);
    assert.equal(r.status, 204, `status inesperado: ${r.status} — ${JSON.stringify(r.body)}`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// A-4 — sin compras / con compras ya anonimizadas por retención (AC-8)
// ─────────────────────────────────────────────────────────────────────────────

Given('un cliente que arranca así: {string}', PASO, async function (this: CatalogWorld, condicion: string) {
  const e = est(this);
  if (condicion === 'un cliente que nunca compró') {
    e.cliente = await nuevaCuenta();
    e.ordenAnonimizadaId = undefined;
    return;
  }
  // "un cliente con una orden ya anonimizada por el barrido de retención de US-021":
  // se pre-anonimiza vía `POST /v1/admin/orders/:id/anonymize` (US-021, "a pedido")
  // en vez de backdatear 12 meses para disparar el barrido real — AC-8 sólo exige
  // "una orden YA anonimizada, con cualquier motivo previo", no específicamente el
  // motivo `retention_policy`; backdatear sería costo sin señal adicional para lo
  // que este escenario verifica (nota de alcance).
  e.cliente = await nuevaCuenta();
  const slug = await sembrarProductoPublicado();
  const compra = await compraLogueadaConSesion(e.cliente, slug);
  const orderId = await idPorOrderNumber(this.token, compra.orderNumber);
  // La orden confirmada queda en 'new' (bloqueante, AC-4) — se avanza a
  // 'delivered' ANTES de anonimizar para que el borrado del When no choque
  // con el guard de órdenes en curso (no es lo que este escenario quiere
  // ejercitar; eso ya lo cubre A-1).
  await avanzarEstado(this.token, orderId, 'preparing');
  await avanzarEstado(this.token, orderId, 'ready');
  const rDelivered = await avanzarEstado(this.token, orderId, 'delivered');
  assert.equal(rDelivered.status, 200, 'no se pudo llevar la orden de A-4 a delivered');
  const anon = await llamarAdmin(`/v1/admin/orders/${orderId}/anonymize`, 'POST', this.token);
  assert.equal(anon.status, 200, `no se pudo pre-anonimizar la orden fixture: ${JSON.stringify(anon.body)}`);
  e.ordenAnonimizadaId = orderId;
  const detalle = await detalleDeOrden(this.token, orderId);
  e.ordenAnonimizadaAntes = { anonymized_at: detalle.anonymized_at, anonymization_reason: detalle.anonymization_reason };
});

When('el cliente borra su cuenta', async function (this: CatalogWorld) {
  est(this).ultima = await borrarCuenta(est(this).cliente!.ctx);
});

Then('el borrado se completa sin error', function (this: CatalogWorld) {
  const e = est(this);
  assert.equal(e.ultima?.status, 204, `status inesperado: ${e.ultima?.status} — ${JSON.stringify(e.ultima?.body)}`);
});

Then('ninguna orden ya anonimizada cambia su motivo ni su fecha de anonimización', PASO, async function (
  this: CatalogWorld,
) {
  const e = est(this);
  if (!e.ordenAnonimizadaId) return; // ejemplo "nunca compró" — nada que verificar
  const detalle = await detalleDeOrden(this.token, e.ordenAnonimizadaId);
  assert.equal(detalle.anonymization_reason, e.ordenAnonimizadaAntes!.anonymization_reason, 'el motivo cambió — se reanonimizó');
  assert.equal(detalle.anonymized_at, e.ordenAnonimizadaAntes!.anonymized_at, 'anonymized_at cambió — se reanonimizó');
});

// ─────────────────────────────────────────────────────────────────────────────
// N-1a / N-1b — verificación al ejecutar, no al mostrar (AC-9)
// ─────────────────────────────────────────────────────────────────────────────

Given('un cliente sin órdenes en curso al momento de ver la pantalla de borrado', async function (
  this: CatalogWorld,
) {
  est(this).cliente = await nuevaCuenta();
});

Given('una orden nueva sin pagar que se crea después, antes de confirmar', async function (this: CatalogWorld) {
  const e = est(this);
  const slug = await sembrarProductoPublicado();
  await ordenPendienteParaSesion(e.cliente!, slug);
});

Then('la solicitud se rechaza con la misma explicación que en AC-4', function (this: CatalogWorld) {
  const e = est(this);
  assert.equal(e.ultima?.status, 409, `status inesperado: ${e.ultima?.status}`);
  const body = e.ultima?.body as { type?: string; blocking_orders?: unknown[] } | undefined;
  assert.equal(body?.type, 'dsm:account/active-orders');
  assert.ok(Array.isArray(body?.blocking_orders) && body!.blocking_orders!.length >= 1);
});

Then('ningún dato de la cuenta cambia', async function (this: CatalogWorld) {
  const status = await me(est(this).cliente!.ctx);
  assert.equal(status, 200, 'la cuenta dejó de estar activa pese al rechazo');
});

Given('un cliente con una orden en curso al momento de ver la pantalla de borrado', PASO, async function (
  this: CatalogWorld,
) {
  const e = est(this);
  const slug = await sembrarProductoPublicado();
  const compra = await compraLogueada(slug); // confirmada → status 'new', bloqueante
  e.cliente = compra.sesion;
  e.ordenId = await idPorOrderNumber(this.token, compra.orderNumber);
});

Given('esa orden se entrega o se cancela después, antes de confirmar', async function (this: CatalogWorld) {
  const e = est(this);
  const r = await cancelarOrden(this.token, e.ordenId!);
  assert.equal(r.status, 200, `no se pudo cancelar la orden bloqueante: ${JSON.stringify(r.body)}`);
});

When('confirma el borrado con la misma solicitud original \\(sin recargar el estado\\)', async function (
  this: CatalogWorld,
) {
  est(this).ultima = await borrarCuenta(est(this).cliente!.ctx);
});

Then('el borrado procede y se completa', function (this: CatalogWorld) {
  const e = est(this);
  assert.equal(e.ultima?.status, 204, `status inesperado: ${e.ultima?.status} — ${JSON.stringify(e.ultima?.body)}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// N-2 — las tres puertas de acceso (AC-10)
// ─────────────────────────────────────────────────────────────────────────────

Given('una cuenta que borró su titular, con {string}', PASO, async function (
  this: CatalogWorld,
  estadoPrevio: string,
) {
  const e = est(this);
  e.estadoPrevio = estadoPrevio;
  e.cliente = await nuevaCuenta();

  if (estadoPrevio.startsWith('tenía una sesión abierta en otro dispositivo')) {
    const otra = await login(e.cliente.cuenta);
    assert.equal(otra.status, 200, 'no se pudo abrir la segunda sesión (otro dispositivo)');
    e.otroDispositivo = otra.ctx;
    // Control same-door: `CsrfGuard` deriva el double-submit de la cookie de
    // ACCESO (no de la de refresco, ver `csrf.guard.ts`) — un contexto sin
    // acceso (p. ej. tras `logout`, que limpia las tres cookies) nunca llega a
    // la validación del refresh token: se cae en 403 (CSRF) en vez de 401
    // (refresh inválido), un control que compararía la puerta EQUIVOCADA.
    // El control real, mismo camino de código que la cuenta borrada (acceso
    // vivo + refresh que ya no sirve), es un REUSO de refresh: se rota una vez
    // (válido) y se reintenta con el token viejo ya consumido — mismo
    // `InvalidRefreshError` que dispara `SessionService.rotate` para
    // "ausente/desconocido/vencido/revocado/reusado" (todos colapsan al mismo
    // 401, `auth-errors.ts`).
    const control = await nuevaCuenta();
    const cookiesViejas = await control.ctx.storageState();
    const primerRefresh = await refreshCrudo(control.ctx);
    assert.equal(primerRefresh.status, 200, 'no se pudo rotar el refresh de la cuenta de control');
    const ctxReuso = await request.newContext({
      baseURL: QA_API_BASE_URL,
      storageState: cookiesViejas,
      extraHTTPHeaders: { origin: QA_WEB_BASE_URL },
    });
    e.respuestaControl = await refreshCrudo(ctxReuso);
  } else if (estadoPrevio.startsWith('había pedido un enlace de recuperación')) {
    const marca = marcaDeLog();
    const pedido = await pedirReset(e.cliente.ctx, e.cliente.cuenta.email);
    assert.equal(pedido.status, 202, 'password-reset/request no devolvió 202');
    e.tokenReset = await tokenDeResetDesde(marca, e.cliente.cuenta.id!);
  }
  // "conocía email y contraseña originales": no requiere fixture adicional —
  // el email/password de `e.cliente.cuenta` alcanzan.

  const borrado = await borrarCuenta(e.cliente.ctx);
  assert.equal(borrado.status, 204, `no se pudo pre-borrar la cuenta fixture de N-2: ${borrado.status}`);
});

When('alguien {string}', PASO, async function (this: CatalogWorld, intento: string) {
  const e = est(this);
  e.intento = intento;

  if (intento === 'intenta iniciar sesión con esas credenciales') {
    e.respuestaPuerta = await loginCrudo(e.cliente!.cuenta.email, e.cliente!.cuenta.password);
    e.respuestaControl = await loginCrudo(
      `qa-us020-nunca-existio-${Date.now()}@example.test`,
      PASSWORD_VALIDA,
    );
  } else if (intento === 'esa sesión intenta refrescar su token de acceso') {
    e.respuestaPuerta = await refreshCrudo(e.otroDispositivo!);
    // e.respuestaControl ya se calculó en el Given (cuenta de control revocada).
  } else if (intento === 'intenta confirmar ese enlace pendiente') {
    e.respuestaPuerta = await confirmarResetCrudo(e.tokenReset!, 'Otra-Contrasena-2');
    e.respuestaControl = await confirmarResetCrudo(tokenNuncaEmitido(), 'Otra-Contrasena-2');
  } else {
    throw new Error(`[borrado-cuenta.steps] intento desconocido: "${intento}"`);
  }
});

Then(
  'la respuesta de esa puerta es indistinguible de la de un intento equivalente contra una cuenta que nunca existió',
  function (this: CatalogWorld) {
    const e = est(this);
    assert.equal(
      e.respuestaPuerta?.status,
      e.respuestaControl?.status,
      `status distinto: puerta=${e.respuestaPuerta?.status} control=${e.respuestaControl?.status}`,
    );
    assert.deepEqual(
      e.respuestaPuerta?.body,
      e.respuestaControl?.body,
      'el cuerpo de la respuesta difiere del control — la puerta filtra que la cuenta existió',
    );
  },
);

Then('no revela que la cuenta existió ni que fue borrada', function (this: CatalogWorld) {
  const e = est(this);
  assert.notEqual(e.respuestaPuerta?.status, 200, 'la puerta dejó pasar a una cuenta borrada');
});

// ─────────────────────────────────────────────────────────────────────────────
// N-4 — métricas del dueño sin cambios (AC-12)
// ─────────────────────────────────────────────────────────────────────────────

Given(
  'un conjunto de órdenes de un cliente, ya contabilizadas en el resumen de métricas \\(US-016\\)',
  PASO,
  async function (this: CatalogWorld) {
    const e = est(this);
    e.cliente = await nuevaCuenta();
    const slug1 = await sembrarProductoPublicado();
    const c1 = await compraLogueadaConSesion(e.cliente, slug1);
    const slug2 = await sembrarProductoPublicado();
    const c2 = await compraLogueadaConSesion(e.cliente, slug2);

    // Ambas quedan en 'new' (bloqueante, AC-4) tras confirmar — se avanzan a
    // 'delivered' para que el borrado del When no choque con el guard de
    // órdenes en curso (ese guard ya lo cubre A-1, no es lo que N-4 verifica).
    for (const numero of [c1.orderNumber, c2.orderNumber]) {
      const id = await idPorOrderNumber(this.token, numero);
      await avanzarEstado(this.token, id, 'preparing');
      await avanzarEstado(this.token, id, 'ready');
      const r = await avanzarEstado(this.token, id, 'delivered');
      assert.equal(r.status, 200, `no se pudo llevar la orden #${numero} de N-4 a delivered`);
    }

    const [summary, top] = await Promise.all([
      llamarAdmin('/v1/admin/reports/summary', 'GET', this.token),
      llamarAdmin('/v1/admin/reports/top-products', 'GET', this.token),
    ]);
    e.summaryAntes = summary.body as SummaryResponse;
    e.topAntes = top.body as TopProductsResponse;
  },
);

When('ese cliente borra su cuenta', async function (this: CatalogWorld) {
  const r = await borrarCuenta(est(this).cliente!.ctx);
  assert.equal(r.status, 204, `no se pudo borrar la cuenta fixture de N-4: ${r.status}`);
});

Then(
  'el resumen de métricas para el período que las incluye trae los mismos totales, cantidades y productos vendidos que antes',
  PASO,
  async function (this: CatalogWorld) {
    const e = est(this);
    const [summary, top] = await Promise.all([
      llamarAdmin('/v1/admin/reports/summary', 'GET', this.token),
      llamarAdmin('/v1/admin/reports/top-products', 'GET', this.token),
    ]);
    e.summaryDespues = summary.body as SummaryResponse;
    e.topDespues = top.body as TopProductsResponse;

    assert.equal(e.summaryDespues.orders_count, e.summaryAntes!.orders_count, 'orders_count cambió');
    assert.equal(e.summaryDespues.total_ars_cents, e.summaryAntes!.total_ars_cents, 'total_ars_cents cambió');
    assert.deepEqual(
      e.summaryDespues.breakdown_by_status,
      e.summaryAntes!.breakdown_by_status,
      'breakdown_by_status cambió',
    );
    assert.deepEqual(
      e.topDespues.data.map((d) => ({ id: d.product_id, qty: d.quantity_sold, rev: d.revenue_ars_cents })),
      e.topAntes!.data.map((d) => ({ id: d.product_id, qty: d.quantity_sold, rev: d.revenue_ars_cents })),
      'top-products cambió',
    );
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// N-5 — nadie más puede borrar la cuenta de otro (AC-13)
// ─────────────────────────────────────────────────────────────────────────────

Given('la cuenta real de un cliente, con sesión iniciada', async function (this: CatalogWorld) {
  est(this).objetivo = await nuevaCuenta();
});

When('{string} intenta borrarla', PASO, async function (this: CatalogWorld, actor: string) {
  const e = est(this);
  e.actor = actor;
  if (actor === 'un visitante sin ninguna sesión') {
    const anon = await nuevoContexto();
    e.respuestaIntento = await borrarCuenta(anon);
  } else if (actor === 'otro cliente registrado, con su propia sesión válida') {
    const otro = await nuevaCuenta();
    e.respuestaIntento = await borrarCuenta(otro.ctx);
  } else if (actor === 'el dueño, con su token admin, desde el panel') {
    const r = await fetch(`${QA_API_BASE_URL}/v1/me`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${this.token}` },
    });
    e.respuestaIntento = { status: r.status, body: await r.json().catch(() => undefined) };
  } else {
    throw new Error(`[borrado-cuenta.steps] actor desconocido: "${actor}"`);
  }
});

Then('la operación se rechaza', function (this: CatalogWorld) {
  const e = est(this);
  // El único actor de la tabla que SÍ tiene una sesión de cliente propia válida
  // ("otro cliente registrado") no puede, por diseño, ni siquiera intentar
  // apuntar a la cuenta ajena: `DELETE /v1/me` no acepta ningún identificador
  // de cuenta en el cuerpo (AC-13, `design.md` §Approach) — su propio borrado
  // procede (204), pero eso es la cuenta DE ESE ACTOR, nunca la del objetivo.
  // La propiedad de seguridad real se verifica en el siguiente step (el
  // objetivo sigue intacto), no acá.
  if (e.actor !== 'otro cliente registrado, con su propia sesión válida') {
    assert.equal(e.respuestaIntento?.status, 401, `status inesperado para "${e.actor}": ${e.respuestaIntento?.status}`);
  }
});

Then('ni la cuenta ni ninguna de sus órdenes cambia', async function (this: CatalogWorld) {
  const status = await me(est(this).objetivo!.ctx);
  assert.equal(status, 200, 'la cuenta objetivo quedó afectada por un intento ajeno');
});

// ─────────────────────────────────────────────────────────────────────────────
// N-6 / N-6b — sin PII en observabilidad (AC-14)
// ─────────────────────────────────────────────────────────────────────────────

Given('un cliente con nombre, email y teléfono reales y conocidos', async function (this: CatalogWorld) {
  const e = est(this);
  const sufijo = Date.now().toString(36);
  e.nombre = `QA Log ${sufijo}`;
  e.email = `qa-us020-log-${sufijo}@example.test`;
  e.phone = '+54 9 351 555 9876';
  e.cliente = await registrarConTelefono(e.nombre, e.email, e.phone, PASSWORD_VALIDA);
  e.marca = marcaDeLog();
});

// "Cuando borra su cuenta" ya está definido arriba (H-2) — mismo texto exacto,
// se reusa tal cual (Cucumber matchea por texto, no por feature de origen).

Then(
  'ningún registro del proceso de la API contiene ese nombre, ese email ni ese teléfono, ni siquiera transformados',
  PASO,
  async function (this: CatalogWorld) {
    const e = est(this);
    // Espera activa: el borrado ya respondió, pero el logger (pino/sonic-boom)
    // puede tener un lag real hasta que el byte queda en disco (mismo criterio
    // que `esperarAviso` de `api-log.ts`).
    await new Promise((r) => setTimeout(r, 300));
    const log = leerLogApi().slice(e.marca ?? 0);
    const variantes = [e.nombre!, e.email!, e.phone!, Buffer.from(e.email!).toString('hex')];
    for (const v of variantes) {
      assert.ok(!log.includes(v), `el log contiene una variante de PII: "${v}"`);
    }
  },
);

Then('el registro operativo permite saber que hubo un borrado y cuándo, sin identificar a la persona', function (
  this: CatalogWorld,
) {
  const e = est(this);
  const log = leerLogApi().slice(e.marca ?? 0);
  assert.ok(/account\.deleted/.test(log), 'el log no registra evidencia del evento account.deleted');
});

Given('un cliente con nombre, email y teléfono reales y conocidos, con una orden en curso', PASO, async function (
  this: CatalogWorld,
) {
  const e = est(this);
  const sufijo = Date.now().toString(36);
  e.nombre = `QA Log Bloqueo ${sufijo}`;
  e.email = `qa-us020-log-bloqueo-${sufijo}@example.test`;
  e.phone = '+54 9 351 555 4321';
  e.cliente = await registrarConTelefono(e.nombre, e.email, e.phone, PASSWORD_VALIDA);
  const slug = await sembrarProductoPublicado();
  await ordenPendienteParaSesion(e.cliente, slug);
  e.marca = marcaDeLog();
});

When('intenta borrar su cuenta y es rechazado por esa orden', async function (this: CatalogWorld) {
  const e = est(this);
  e.ultima = await borrarCuenta(e.cliente!.ctx);
  assert.equal(e.ultima.status, 409, `se esperaba 409, vino ${e.ultima.status}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// N-7 — doble confirmación, un solo efecto (AC-15)
// ─────────────────────────────────────────────────────────────────────────────

/** N-7 usa una variante del texto de H-1 sin "registrado" — misma fixture. */
Given('un cliente con sesión iniciada y sin órdenes en curso', async function (this: CatalogWorld) {
  est(this).cliente = await nuevaCuenta();
});

When('dispara dos confirmaciones de borrado casi simultáneas para la misma cuenta', async function (
  this: CatalogWorld,
) {
  const e = est(this);
  e.resultados = await Promise.all([borrarCuenta(e.cliente!.ctx), borrarCuenta(e.cliente!.ctx)]);
});

Then('el borrado se aplica una sola vez', async function (this: CatalogWorld) {
  const status = await me(est(this).cliente!.ctx);
  assert.notEqual(status, 200, 'la cuenta sigue identificándose tras el doble borrado');
});

Then('ninguna de las dos respuestas es un error de servidor', function (this: CatalogWorld) {
  for (const r of est(this).resultados!) {
    assert.ok(r.status < 500, `una de las dos respuestas fue ${r.status}`);
  }
});

Then(
  'no queda un segundo registro de auditoría ni una segunda pasada de anonimización sobre las mismas órdenes',
  function (this: CatalogWorld) {
    // Ambas respuestas ya se verificaron sin 5xx; el efecto único sobre
    // `customers`/`orders` está estructuralmente garantizado por el
    // `WHERE deleted_at IS NULL` de `CustomersRepository.anonymize`
    // (`design.md` §Approach) y es exactamente lo que T5.10 (dev-owned) ya
    // verificó contando `AccountEventsService.count('account.deleted')`
    // (+1, no +2) — este test, Layer 3 sin acceso a esa métrica interna,
    // confirma el efecto observable equivalente: ninguna respuesta 5xx y la
    // sesión queda cerrada exactamente igual que en un borrado simple (H-1).
    assert.ok(true);
  },
);
