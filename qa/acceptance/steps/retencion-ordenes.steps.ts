import assert from 'node:assert/strict';
import { Given, When, Then } from '@cucumber/cucumber';
import jwt from 'jsonwebtoken';
import { apiCall } from '../../support/api';
import { QA_API_BASE_URL } from '../../support/qa-env';
import {
  seedOrdenesRetencion,
  type OrdenRetencionSembrada,
} from '../../support/seed-orders-retention';
import type { CatalogWorld } from './world';

/**
 * US-021 — Retención y anonimización de los datos personales de las órdenes.
 *
 * BLOQUEADO POR IMPLEMENTACIÓN (verificado, no asumido): al escribir estos
 * step defs, `openspec/changes/US-021-retencion-datos-ordenes-backend/tasks.md`
 * tiene 0/16 tasks cerradas — ni `OrdersRetentionController`/`Service`/`Runner`
 * ni las columnas `anonymized_at`/`anonymization_reason` existen todavía en
 * `packages/db/prisma/schema.prisma`. Cada llamada de este archivo a
 * `POST /v1/admin/orders/:id/anonymize` o `POST /v1/admin/orders/retention-sweep`
 * va a fallar (404 de ruta inexistente) hasta que `/develop-backend US-021`
 * construya los dos endpoints — eso es exactamente lo esperado hoy, no un test
 * mal escrito. Ver el reporte de la corrida que scaffoldeó este archivo.
 */

/** Los pasos tocan red (seed vía checkout real + Postgres); 5 s del default es corto. */
const PASO = { timeout: 60_000 };

const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-secret';

interface Estado {
  /** Orden vencida (más allá del corte de retención), sin anonimizar todavía. */
  vencida?: OrdenRetencionSembrada;
  /** Orden reciente (dentro de la ventana), sin anonimizar todavía. */
  reciente?: OrdenRetencionSembrada;
  /** Conjunto de N órdenes vencidas con ítems/total conocidos (SC-021-H2). */
  conjunto?: OrdenRetencionSembrada[];
  /** Última respuesta de escritura (para asertar status/negative-space). */
  ultima?: { status: number; body: any };
  /** Listados de `GET /v1/admin/orders`, antes y después del barrido. */
  listadoAntes?: AdminOrderSummary[];
  listadoDespues?: AdminOrderSummary[];
  /** Detalles de `GET /v1/admin/orders/:id`, antes y después, por id de orden. */
  detalleAntes?: Record<string, AdminOrderDetail>;
  detalleDespues?: Record<string, AdminOrderDetail>;
  /** `Date.now()` justo antes de disparar la anonimización a pedido (SC-021-H3). */
  momentoPedido?: number;
  /** SC-021-H4: primera orden (vencida → barrida) y segunda (a pedido). */
  primeraOrden?: OrdenRetencionSembrada;
  segundaOrden?: OrdenRetencionSembrada;
  respuestaPrimera?: { status: number; body: any };
  respuestaSegunda?: { status: number; body: any };
  /** Orden ya anonimizada (SC-021-A1, SC-021-N3). */
  anonimizada?: OrdenRetencionSembrada;
  primerAnonymizedAt?: string;
  /** SC-021-N1: total de órdenes en el listado antes del barrido. */
  totalAntes?: number;
  /** SC-021-N4: cuántas anonimizó la primera corrida del barrido. */
  conteoPrimeraCorrida?: number;
}

function est(w: CatalogWorld): Estado {
  w.state.retencion ??= {};
  return w.state.retencion as Estado;
}

interface AdminOrderSummary {
  id: string;
  order_number: number;
  buyer_name: string;
  total_ars_cents: number;
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
  items: AdminOrderItem[];
}

interface AdminOrdersListResponse {
  data: AdminOrderSummary[];
  pagination: { limit: number; offset: number; total: number };
}

async function listarOrdenes(token: string): Promise<AdminOrderSummary[]> {
  // `limit` alto: el default (20) alcanza mientras la suite corra sola contra
  // una base local, pero no hay que asumirlo cuando este mismo Postgres
  // acumula órdenes de otras corridas — per D-4, no degradar en silencio.
  const res = await apiCall<AdminOrdersListResponse>(
    '/v1/admin/orders?limit=100',
    'GET',
    token,
  );
  return res.data;
}

async function detalleDeOrden(token: string, id: string): Promise<AdminOrderDetail> {
  return apiCall<AdminOrderDetail>(`/v1/admin/orders/${id}`, 'GET', token);
}

/** Llamada admin que **no** lanza ante 4xx/5xx — a diferencia de `apiCall`, acá el
 * status/body no-2xx es exactamente lo que varios escenarios necesitan asertar. */
async function llamarComoAdmin(
  path: string,
  method: string,
  token?: string,
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${QA_API_BASE_URL}${path}`, {
    method,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  return { status: res.status, body: await res.json().catch(() => undefined) };
}

async function dispararSweep(w: CatalogWorld): Promise<{ status: number; body: any }> {
  const r = await llamarComoAdmin(
    '/v1/admin/orders/retention-sweep',
    'POST',
    w.token,
  );
  est(w).ultima = r;
  return r;
}

async function dispararAnonimizacion(
  w: CatalogWorld,
  id: string,
  token = w.token,
): Promise<{ status: number; body: any }> {
  return llamarComoAdmin(`/v1/admin/orders/${id}/anonymize`, 'POST', token);
}

/** Credenciales de SC-021-N5 (Esquema del escenario) — allowlist cerrada de la tabla `Ejemplos`. */
function credencialPara(tipo: string): string | undefined {
  switch (tipo) {
    case 'sin Authorization':
      return undefined;
    case 'JWT expirado':
      return jwt.sign({ role: 'admin', sub: 'admin' }, JWT_SECRET, {
        expiresIn: '-1h',
      });
    case 'JWT válido con role distinto de admin':
      return jwt.sign({ role: 'customer', sub: 'qa-customer' }, JWT_SECRET, {
        expiresIn: '1h',
      });
    default:
      throw new Error(`[retencion-ordenes.steps] credencial desconocida: "${tipo}"`);
  }
}

/**
 * Placeholder de anonimización: comparación por **regex del dominio
 * `.invalid`**, no un import directo de
 * `apps/api/src/checkout/order-anonymization.ts` (qa-plan.md US-021 §7) — ese
 * archivo, backend puro, no es una dependencia de `@dsm/qa` (que sólo depende
 * de `@dsm/db`); importarlo rompería la carga de **todo** este archivo de
 * steps (y con ella, toda la suite de aceptación) apenas Cucumber cargara el
 * glob de `acceptance/steps/**`, no sólo estos escenarios.
 */
const DOMINIO_ANONIMIZADO = /@.*\.invalid$/i;

function esComparadorOriginal(
  orden: { buyer_name: string; buyer_email: string; buyer_phone: string },
  original: { buyerName: string; buyerEmail: string; buyerPhone: string },
): boolean {
  return (
    orden.buyer_name === original.buyerName &&
    // Case-insensitive: `checkout.service.ts` normaliza el email a minúsculas
    // al persistir (`normalizeEmail`, `apps/api/src/auth/email/normalize-email.ts`)
    // — comportamiento real esperado, no un bug de anonimización. El fixture de
    // seed genera el email con el prefijo de corrida en mayúsculas
    // (`buildOrderRetentionFixture`), así que una comparación case-sensitive
    // acá fallaba SIEMPRE para la orden "reciente" (detectado corriendo la
    // suite contra la implementación real, no una debilidad de assert).
    orden.buyer_email.toLowerCase() === original.buyerEmail.toLowerCase() &&
    orden.buyer_phone === original.buyerPhone
  );
}

function assertPlaceholderAnonimizado(
  orden: { buyer_name: string; buyer_email: string; buyer_phone: string },
  original: { buyerName: string; buyerEmail: string; buyerPhone: string },
): void {
  assert.notEqual(
    orden.buyer_name,
    original.buyerName,
    'buyer_name sigue siendo el original — no se anonimizó',
  );
  assert.notEqual(
    orden.buyer_email,
    original.buyerEmail,
    'buyer_email sigue siendo el original — no se anonimizó',
  );
  assert.match(
    orden.buyer_email,
    DOMINIO_ANONIMIZADO,
    `buyer_email "${orden.buyer_email}" no usa el dominio placeholder .invalid`,
  );
  assert.notEqual(
    orden.buyer_phone,
    original.buyerPhone,
    'buyer_phone sigue siendo el original — no se anonimizó',
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Antecedentes
// ─────────────────────────────────────────────────────────────────────────────

// "Dado un catálogo sembrado con productos disponibles" NO se registra acá: ya
// existe como step global no-op en `pago-manual.steps.ts` (mismo texto literal,
// Antecedentes compartido entre features) — Cucumber carga TODO el glob
// `acceptance/steps/**/*.ts` junto, así que una segunda `Given` con el mismo
// texto es una colisión ("Multiple step definitions match"), no una feature
// aislada. El catálogo real de este feature lo siembra `seedOrdenesRetencion`
// (1 producto publicado por corrida) desde cada `Given` de orden puntual.

Given('un token admin real \\(AdminGuard\\)', function (this: CatalogWorld) {
  assert.ok(this.token, 'no hay token admin — el Before() no logueó');
});

// ─────────────────────────────────────────────────────────────────────────────
// SC-021-H1 — el barrido anonimiza toda orden vencida y ninguna otra (AC-1)
// ─────────────────────────────────────────────────────────────────────────────

Given(
  'una orden con más de ORDER_RETENTION_MONTHS de antigüedad, sin anonimizar',
  PASO,
  async function (this: CatalogWorld) {
    const seed = await seedOrdenesRetencion({ vencidas: 1, token: this.token });
    est(this).vencida = seed.vencidas[0];
  },
);

Given('una segunda orden reciente, sin anonimizar', PASO, async function (
  this: CatalogWorld,
) {
  const seed = await seedOrdenesRetencion({ recientes: 1, token: this.token });
  est(this).reciente = seed.recientes[0];
});

When('se dispara {string} con el token admin', PASO, async function (
  this: CatalogWorld,
  _endpoint: string,
) {
  await dispararSweep(this);
});

Then('la respuesta trae anonymized_count igual a {int}', function (
  this: CatalogWorld,
  esperado: number,
) {
  const body = est(this).ultima?.body as { anonymized_count?: number } | undefined;
  assert.equal(
    body?.anonymized_count,
    esperado,
    `anonymized_count vino ${body?.anonymized_count}, se esperaba ${esperado}`,
  );
});

Then(
  'la orden vencida tiene buyer_name\\/buyer_email\\/buyer_phone reemplazados por los valores placeholder',
  PASO,
  async function (this: CatalogWorld) {
    const e = est(this);
    const orden = await detalleDeOrden(this.token, e.vencida!.id);
    assertPlaceholderAnonimizado(orden, e.vencida!);
  },
);

Then('la orden reciente conserva sus datos de comprador intactos', PASO,
  async function (this: CatalogWorld) {
    const e = est(this);
    const orden = await detalleDeOrden(this.token, e.reciente!.id);
    assert.ok(
      esComparadorOriginal(orden, e.reciente!),
      'la orden reciente cambió sus datos de comprador sin haber vencido',
    );
  },
);

Then(
  'ambas órdenes siguen existiendo con su status y su total_ars_cents sin cambios',
  PASO,
  async function (this: CatalogWorld) {
    const e = est(this);
    for (const original of [e.vencida!, e.reciente!]) {
      const orden = await detalleDeOrden(this.token, original.id);
      assert.equal(orden.status, 'new', `la orden ${original.orderNumber} cambió de status`);
      assert.equal(
        orden.total_ars_cents,
        original.totalArsCents,
        `total_ars_cents cambió en la orden ${original.orderNumber}`,
      );
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// SC-021-H2 — el barrido no altera los agregados comerciales (AC-2)
// ─────────────────────────────────────────────────────────────────────────────

Given(
  'un conjunto de {int} órdenes vencidas con ítems y total_ars_cents conocidos',
  PASO,
  async function (this: CatalogWorld, n: number) {
    const seed = await seedOrdenesRetencion({ vencidas: n, token: this.token });
    est(this).conjunto = seed.vencidas;
  },
);

Given('consultadas por {string} antes del barrido', PASO, async function (
  this: CatalogWorld,
  _endpoint: string,
) {
  const e = est(this);
  e.listadoAntes = await listarOrdenes(this.token);
  e.detalleAntes = {};
  for (const o of e.conjunto!) {
    e.detalleAntes[o.id] = await detalleDeOrden(this.token, o.id);
  }
});

When('se anonimizan las {int} mediante el barrido', PASO, async function (
  this: CatalogWorld,
  _n: number,
) {
  await dispararSweep(this);
});

When('se vuelve a consultar {string}', PASO, async function (
  this: CatalogWorld,
  _endpoint: string,
) {
  const e = est(this);
  e.listadoDespues = await listarOrdenes(this.token);
  e.detalleDespues = {};
  for (const o of e.conjunto!) {
    e.detalleDespues![o.id] = await detalleDeOrden(this.token, o.id);
  }
});

function sumaTotal(ordenes: AdminOrderSummary[], ids: string[]): number {
  return ordenes
    .filter((o) => ids.includes(o.id))
    .reduce((acc, o) => acc + o.total_ars_cents, 0);
}

Then(
  'la suma de total_ars_cents de las {int} órdenes es idéntica antes y después',
  function (this: CatalogWorld, _n: number) {
    const e = est(this);
    const ids = e.conjunto!.map((o) => o.id);
    const antes = sumaTotal(e.listadoAntes!, ids);
    const despues = sumaTotal(e.listadoDespues!, ids);
    assert.equal(despues, antes, `la suma cambió: ${antes} → ${despues}`);
  },
);

function conteoPorStatus(ordenes: AdminOrderSummary[]): Record<string, number> {
  return ordenes.reduce<Record<string, number>>((acc, o) => {
    acc[o.status] = (acc[o.status] ?? 0) + 1;
    return acc;
  }, {});
}

Then('la cantidad de órdenes devueltas por status es idéntica antes y después', function (
  this: CatalogWorld,
) {
  const e = est(this);
  assert.deepEqual(
    conteoPorStatus(e.listadoDespues!),
    conteoPorStatus(e.listadoAntes!),
    'la distribución de órdenes por status cambió tras el barrido',
  );
});

Then(
  'para cada orden, {string} devuelve los mismos items, quantity y unit_price_ars_cents que antes de anonimizar',
  function (this: CatalogWorld, _endpoint: string) {
    const e = est(this);
    for (const o of e.conjunto!) {
      const antes = e.detalleAntes![o.id].items;
      const despues = e.detalleDespues![o.id].items;
      assert.deepEqual(
        despues.map((i) => ({
          quantity: i.quantity,
          unit_price_ars_cents: i.unit_price_ars_cents,
          product_sku: i.product_sku,
        })),
        antes.map((i) => ({
          quantity: i.quantity,
          unit_price_ars_cents: i.unit_price_ars_cents,
          product_sku: i.product_sku,
        })),
        `los items de la orden ${o.orderNumber} cambiaron tras anonimizar`,
      );
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// SC-021-H3 — anonimización a pedido responde de inmediato (AC-3)
// ─────────────────────────────────────────────────────────────────────────────

Given('una orden existente, sin anonimizar', PASO, async function (this: CatalogWorld) {
  const seed = await seedOrdenesRetencion({ recientes: 1, token: this.token });
  est(this).reciente = seed.recientes[0];
});

When(
  'el dueño dispara {string} con su token admin',
  PASO,
  async function (this: CatalogWorld, _endpoint: string) {
    const e = est(this);
    e.momentoPedido = Date.now();
    e.ultima = await dispararAnonimizacion(this, e.reciente!.id);
  },
);

Then(
  'la respuesta es 200 con order_id, anonymized_at y anonymization_reason igual a {string}',
  function (this: CatalogWorld, reason: string) {
    const e = est(this);
    assert.equal(e.ultima?.status, 200, `status inesperado: ${e.ultima?.status}`);
    const body = e.ultima?.body as
      | { order_id?: string; anonymized_at?: string; anonymization_reason?: string }
      | undefined;
    assert.equal(body?.order_id, e.reciente!.id, 'order_id no coincide con la orden anonimizada');
    assert.ok(body?.anonymized_at, 'falta anonymized_at en la respuesta');
    assert.equal(
      body?.anonymization_reason,
      reason,
      `anonymization_reason vino "${body?.anonymization_reason}", se esperaba "${reason}"`,
    );
  },
);

Then('anonymized_at está dentro de los {int} segundos del momento del pedido', function (
  this: CatalogWorld,
  segundos: number,
) {
  const e = est(this);
  const body = e.ultima?.body as { anonymized_at?: string } | undefined;
  const delta = Math.abs(new Date(body!.anonymized_at!).getTime() - e.momentoPedido!);
  assert.ok(
    delta <= segundos * 1000,
    `anonymized_at está a ${delta}ms del pedido, fuera de la ventana de ${segundos}s`,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// SC-021-H4 — la anonimización registra y distingue el motivo (AC-4)
// ─────────────────────────────────────────────────────────────────────────────

Given('una orden anonimizada por plazo cumplido', PASO, async function (
  this: CatalogWorld,
) {
  const e = est(this);
  const seed = await seedOrdenesRetencion({ vencidas: 1, token: this.token });
  e.primeraOrden = seed.vencidas[0];
  await dispararSweep(this); // barre la vencida → reason: 'retention_policy'
});

Given('una segunda orden anonimizada a pedido', PASO, async function (
  this: CatalogWorld,
) {
  const e = est(this);
  const seed = await seedOrdenesRetencion({ recientes: 1, token: this.token });
  e.segundaOrden = seed.recientes[0];
  await dispararAnonimizacion(this, e.segundaOrden.id); // reason: 'requested'
});

When(
  'se re-consulta cada una llamando de nuevo a su endpoint de anonimización \\(idempotente — no produce un segundo efecto, ver AC-8\\)',
  PASO,
  async function (this: CatalogWorld) {
    const e = est(this);
    // "Re-consultar" acá es re-llamar al mismo endpoint de anonimizar sobre una
    // orden ya anonimizada — idempotente por diseño (AC-8): devuelve el mismo
    // resultado, incluido `anonymization_reason`, sin producir un segundo
    // efecto. Es la única superficie hoy que expone el motivo (ver nota de
    // alcance del .feature, §1.3 del qa-plan).
    e.respuestaPrimera = await dispararAnonimizacion(this, e.primeraOrden!.id);
    e.respuestaSegunda = await dispararAnonimizacion(this, e.segundaOrden!.id);
  },
);

Then('la primera trae anonymization_reason {string}', function (
  this: CatalogWorld,
  reason: string,
) {
  const body = est(this).respuestaPrimera?.body as
    | { anonymization_reason?: string }
    | undefined;
  assert.equal(body?.anonymization_reason, reason);
});

Then('la segunda trae anonymization_reason {string}', function (
  this: CatalogWorld,
  reason: string,
) {
  const body = est(this).respuestaSegunda?.body as
    | { anonymization_reason?: string }
    | undefined;
  assert.equal(body?.anonymization_reason, reason);
});

// ─────────────────────────────────────────────────────────────────────────────
// SC-021-A1 — una orden anonimizada sigue siendo operable (AC-5)
// ─────────────────────────────────────────────────────────────────────────────

Given('una orden anonimizada', PASO, async function (this: CatalogWorld) {
  const e = est(this);
  const seed = await seedOrdenesRetencion({ recientes: 1, token: this.token });
  e.anonimizada = seed.recientes[0];
  const r = await dispararAnonimizacion(this, e.anonimizada.id);
  assert.equal(r.status, 200, `no se pudo anonimizar la orden fixture: ${r.status}`);
});

When('el dueño la consulta con {string}', PASO, async function (
  this: CatalogWorld,
  _endpoint: string,
) {
  const e = est(this);
  e.detalleDespues = { [e.anonimizada!.id]: await detalleDeOrden(this.token, e.anonimizada!.id) };
});

Then('ve sus items, quantity, unit_price_ars_cents, status y created_at sin cambios', function (
  this: CatalogWorld,
) {
  const e = est(this);
  const orden = e.detalleDespues![e.anonimizada!.id];
  assert.equal(orden.status, 'new', 'el status cambió al anonimizar');
  assert.ok(orden.items.length >= 1, 'la orden anonimizada perdió sus items');
  for (const item of orden.items) {
    assert.ok(item.quantity > 0, 'quantity no debería ser 0/negativo');
    assert.ok(item.unit_price_ars_cents > 0, 'unit_price_ars_cents no debería ser 0');
  }
});

Then(
  'buyer_name\\/buyer_email\\/buyer_phone muestran los valores placeholder de anonimización, no los datos originales del comprador',
  function (this: CatalogWorld) {
    const e = est(this);
    const orden = e.detalleDespues![e.anonimizada!.id];
    assertPlaceholderAnonimizado(orden, e.anonimizada!);
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// SC-021-N1 — ninguna orden ni ítem se borra al anonimizar (AC-6)
// ─────────────────────────────────────────────────────────────────────────────

Given('{int} órdenes en estado activo \\(una vencida, una no\\) consultables por {string}', PASO,
  async function (this: CatalogWorld, _n: number, _endpoint: string) {
    const e = est(this);
    const seed = await seedOrdenesRetencion({
      vencidas: 1,
      recientes: 1,
      token: this.token,
    });
    e.vencida = seed.vencidas[0];
    e.reciente = seed.recientes[0];
  },
);

Given('el total de órdenes en ese listado antes del barrido', PASO, async function (
  this: CatalogWorld,
) {
  const e = est(this);
  e.listadoAntes = await listarOrdenes(this.token);
  e.totalAntes = e.listadoAntes.length;
});

When('corre el barrido de retención', PASO, async function (this: CatalogWorld) {
  await dispararSweep(this);
});

Then('el total de órdenes en {string} es idéntico al de antes', PASO, async function (
  this: CatalogWorld,
  _endpoint: string,
) {
  const e = est(this);
  e.listadoDespues = await listarOrdenes(this.token);
  assert.equal(
    e.listadoDespues.length,
    e.totalAntes,
    `el listado tenía ${e.totalAntes} órdenes y ahora tiene ${e.listadoDespues.length} — algo se borró o se ocultó`,
  );
});

Then(
  '{string} de la orden vencida sigue devolviendo sus items \\(ningún item desapareció\\)',
  PASO,
  async function (this: CatalogWorld, _endpoint: string) {
    const e = est(this);
    const orden = await detalleDeOrden(this.token, e.vencida!.id);
    assert.ok(orden.items.length >= 1, 'la orden vencida se quedó sin items tras el barrido');
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// SC-021-N2 (TC-021-007, execution_mode: manual) — @deferred en el .feature,
// sin step defs a propósito: no hay superficie API para automatizarlo (ver la
// nota del .feature y qa-plan.md §1.3/§4). No se registran Given/When/Then acá.
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// SC-021-N3 — anonimizar dos veces no produce error ni un segundo efecto (AC-8)
// ─────────────────────────────────────────────────────────────────────────────

Given('una orden ya anonimizada', PASO, async function (this: CatalogWorld) {
  const e = est(this);
  const seed = await seedOrdenesRetencion({ recientes: 1, token: this.token });
  e.anonimizada = seed.recientes[0];
  const primera = await dispararAnonimizacion(this, e.anonimizada.id);
  assert.equal(primera.status, 200, `no se pudo anonimizar la orden fixture: ${primera.status}`);
  e.primerAnonymizedAt = (primera.body as { anonymized_at?: string }).anonymized_at;
});

When(
  'se dispara de nuevo {string} sobre la misma orden',
  PASO,
  async function (this: CatalogWorld, _endpoint: string) {
    est(this).ultima = await dispararAnonimizacion(this, est(this).anonimizada!.id);
  },
);

Then('la respuesta es 200 con el mismo anonymized_at que la primera vez', function (
  this: CatalogWorld,
) {
  const e = est(this);
  assert.equal(e.ultima?.status, 200, `status inesperado: ${e.ultima?.status}`);
  const body = e.ultima?.body as { anonymized_at?: string } | undefined;
  assert.equal(
    body?.anonymized_at,
    e.primerAnonymizedAt,
    'anonymized_at cambió en la segunda llamada — no es idempotente',
  );
});

Then('no se produce ningún error', function (this: CatalogWorld) {
  const status = est(this).ultima?.status;
  assert.ok(status && status < 400, `se produjo un error: status ${status}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// SC-021-N4 — el barrido corrido dos veces con el mismo corte no re-anonimiza (AC-8)
// ─────────────────────────────────────────────────────────────────────────────

Given('que el barrido ya corrió una vez y anonimizó N órdenes', PASO, async function (
  this: CatalogWorld,
) {
  const e = est(this);
  await seedOrdenesRetencion({ vencidas: 1, token: this.token });
  const primera = await dispararSweep(this);
  e.conteoPrimeraCorrida = (primera.body as { anonymized_count?: number })?.anonymized_count;
  assert.ok(
    e.conteoPrimeraCorrida && e.conteoPrimeraCorrida >= 1,
    `la primera corrida no anonimizó nada: ${JSON.stringify(primera.body)}`,
  );
});

When(
  'se dispara {string} de nuevo, sin nuevas órdenes vencidas',
  PASO,
  async function (this: CatalogWorld, _endpoint: string) {
    await dispararSweep(this);
  },
);

// "la respuesta trae anonymized_count igual a {int}" y "no se produce ningún error"
// ya están definidos arriba (SC-021-H1 / SC-021-N3) — se reusan tal cual.

// ─────────────────────────────────────────────────────────────────────────────
// SC-021-N5 — sólo el dueño autenticado puede anonimizar a pedido (AC-9)
// ─────────────────────────────────────────────────────────────────────────────
// "Dado una orden existente, sin anonimizar" ya está definido arriba (SC-021-H3).

When('alguien intenta {string} con {string}', PASO, async function (
  this: CatalogWorld,
  _endpoint: string,
  credencial: string,
) {
  const e = est(this);
  const token = credencialPara(credencial);
  // NO se usa `dispararAnonimizacion` acá a propósito: su parámetro `token` tiene
  // un default (`= w.token`) que en JS se activa con `undefined` — exactamente el
  // valor que `credencialPara('sin Authorization')` devuelve para decir "sin
  // header". Pasar ese `undefined` por el wrapper resustituía en silencio el token
  // admin real (200 en vez de 401 — bug de test detectado corriendo la suite por
  // primera vez contra la implementación real, no un defecto del backend). Se
  // llama `llamarComoAdmin` directo, que sí distingue "sin token" de "con token".
  e.ultima = await llamarComoAdmin(
    `/v1/admin/orders/${e.reciente!.id}/anonymize`,
    'POST',
    token,
  );
});

Then('la respuesta es {string}', function (this: CatalogWorld, status: string) {
  assert.equal(String(est(this).ultima?.status), status);
});

Then('la orden no cambia \\(buyer_name sigue siendo el original tras el intento\\)', PASO,
  async function (this: CatalogWorld) {
    const e = est(this);
    // Se relee con el token admin REAL de la suite (`this.token`), no con la
    // credencial bajo prueba — el punto es confirmar que el intento rechazado
    // no tuvo efecto, no volver a probar el guard.
    const orden = await detalleDeOrden(this.token, e.reciente!.id);
    assert.equal(
      orden.buyer_name,
      e.reciente!.buyerName,
      'buyer_name cambió pese a que la anonimización debía haber sido rechazada',
    );
  },
);
