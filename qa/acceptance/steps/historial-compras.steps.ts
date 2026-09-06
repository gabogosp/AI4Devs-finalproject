import assert from 'node:assert/strict';
import { AfterAll, Given, Then, When } from '@cucumber/cucumber';
import { request } from '@playwright/test';
// `@dsm/db` es CJS y `@dsm/qa` es ESM: los named exports no son analizables
// estáticamente — mismo patrón que `retencion-ordenes.steps.ts`/`pago-webhook.steps.ts`.
import db from '@dsm/db';
import { apiCall } from '../../support/api';
import { backdateOrder } from '../../support/backdate-order';
import { buildBuyerData, buildCheckoutBody } from '../../support/builders';
import { nuevoInvitado } from '../../support/cart-client';
import { nuevaCuenta, nuevoContexto, PASSWORD_VALIDA, type Sesion } from '../../support/customer-auth';
import { QA_API_BASE_URL } from '../../support/qa-env';
import {
  compraLogueada,
  compraLogueadaConSesion,
  compraLogueadaPendiente,
  sembrarProductoPublicado,
  type CompraLogueada,
} from '../../support/seed-order-history';
import { dispararAnonimizacion } from './retencion-ordenes.steps';
import type { CatalogWorld } from './world';

/**
 * US-015 — Historial de compras del cliente registrado (`qa-plan.md` §4-§5,
 * `design.md` §D-QA3/§D-QA4/§D-QA5/§D-QA6).
 *
 * "Dado un catálogo sembrado con productos disponibles" NO se registra acá:
 * ya existe como step global no-op en `pago-manual.steps.ts` (mismo texto
 * literal, Antecedentes compartido entre features) — mismo criterio que
 * `retencion-ordenes.steps.ts` ya documenta con su propio comentario. El
 * catálogo real de este feature lo siembra `sembrarProductoPublicado()`
 * (`qa/support/seed-order-history.ts`), invocado desde cada `Given` puntual —
 * cada escenario siembra su propio producto y su propia cuenta, nunca reusa
 * los de otro (`qa-plan.md` §9).
 *
 * **SC-015-N3 — resolución de la pregunta abierta del plan** (override de
 * email en el seed de cuentas): `qa/support/customer-auth.ts` NO soporta
 * fijar el email COMPLETO de una cuenta nueva — `datosDeCuenta(sufijo)` sólo
 * agrega un sufijo al email generado, nunca lo reemplaza entero. Se usa el
 * fallback documentado por el plan: registro DIRECTO vía `POST /v1/auth/register`
 * (`registrarCuentaConEmail`, abajo), reusando `nuevoContexto()` (ya exportado
 * por `customer-auth.ts` — misma IP simulada por contexto, mismo `Origin`) en
 * vez de escribir un cliente HTTP nuevo. No se modificó `customer-auth.ts`
 * para esto: agregar un parámetro de email completo a `nuevaCuenta()` hoy
 * serviría un único escenario de un único change, y el fallback ya cubre el
 * caso sin tocar un helper compartido por el resto de la suite.
 */

const API = QA_API_BASE_URL;
const PASO = { timeout: 60_000 };

// ─────────────────────────────────────────────────────────────────────────────
// Resolución del UUID interno por `order_number` (T2.1, `design.md` §D-QA4):
// el historial del cliente NUNCA expone el UUID interno (AC-1/AC-2, por
// diseño), así que `backdateOrder` (que sí lo necesita) se resuelve acá por
// Prisma directo — excepción angosta y documentada, sólo para llegar a la
// precondición de antigüedad, nunca para sembrar ni para simular el efecto
// que el escenario prueba (mismo criterio que `backdate-order.ts` mismo).
// ─────────────────────────────────────────────────────────────────────────────
const { PrismaClient } = db as unknown as {
  PrismaClient: new () => {
    order: {
      findUniqueOrThrow(args: {
        where: { order_number: number };
      }): Promise<{ id: string }>;
    };
    $disconnect(): Promise<void>;
  };
};
const prisma = new PrismaClient();
AfterAll(async () => {
  await prisma.$disconnect();
});

async function idPorOrderNumber(orderNumber: number): Promise<string> {
  const orden = await prisma.order.findUniqueOrThrow({ where: { order_number: orderNumber } });
  return orden.id;
}

// ─────────────────────────────────────────────────────────────────────────────
// Retención en el borde (SC-015-C1): margen de seguridad de 5s contra el
// clock-drift entre sembrar y consultar (`flakiness-detection` señal 4 —
// asserts dependientes del tiempo). Probar el borde a la MILISÉCUNDA exacta
// (como dice el Gherkin) es estructuralmente no determinístico: entre que
// este proceso calcula el corte y el servidor calcula EL SUYO (en el momento
// de atender el GET) pasa tiempo real no-cero, así que "exactamente en el
// corte" con 0ms de margen fallaría por una carrera, no por un defecto. Se
// prueba el MISMO borde inclusivo (`gte`) con un margen de 5s en cada
// dirección — sigue siendo una prueba real del límite, sin la flakiness de
// intentar acertar el milisegundo exacto contra un reloj que se mueve.
// ─────────────────────────────────────────────────────────────────────────────
const RETENTION_MONTHS = Number(process.env.ORDER_RETENTION_MONTHS ?? 12);
const MARGEN_MS = 5_000;

function corteAhoraMismo(): Date {
  const d = new Date();
  d.setMonth(d.getMonth() - RETENTION_MONTHS);
  return d;
}

async function backdatearAlBorde(orderId: string, direccion: 'dentro' | 'fuera'): Promise<void> {
  const corte = corteAhoraMismo();
  const objetivo = new Date(corte.getTime() + (direccion === 'dentro' ? MARGEN_MS : -MARGEN_MS));
  const horasAtras = (Date.now() - objetivo.getTime()) / 3_600_000;
  await backdateOrder(orderId, horasAtras);
}

/** Registro directo vía `POST /v1/auth/register` con un email fijo (SC-015-N3, ver cabecera). */
async function registrarCuentaConEmail(email: string): Promise<Sesion> {
  const ctx = await nuevoContexto();
  const res = await ctx.post('/v1/auth/register', {
    data: { email, name: 'QA Cuenta N3', password: PASSWORD_VALIDA },
  });
  if (res.status() !== 201 && res.status() !== 200) {
    throw new Error(
      `[qa/historial-compras] registro directo con email compartido falló: ` +
        `${res.status()} — ${await res.text()}`,
    );
  }
  const cuerpo = (await res.json()) as { customer: { id: string } };
  return {
    ctx,
    cuenta: { id: cuerpo.customer.id, email, password: PASSWORD_VALIDA, nombre: 'QA Cuenta N3' },
  };
}

interface OrderHistorySummary {
  order_number: number;
  status: string;
  total_ars_cents: number;
  created_at: string;
}
interface OrderHistoryListResponse {
  data: OrderHistorySummary[];
  pagination: { limit: number; offset: number; total: number };
}
interface AdminOrderSummary {
  id: string;
  order_number: number;
}

interface EstadoHistorial {
  /** Sesión del cliente cuyo historial se consulta en ESTE escenario. */
  sesionActiva?: Sesion;
  /** Compra principal/única del cliente bajo prueba. */
  compraA?: CompraLogueada;
  /** Segunda compra del MISMO cliente (SC-015-H1). */
  compraA2?: CompraLogueada;
  /** Compra de OTRO cliente distinto (SC-015-H1, SC-015-N2). */
  compraB?: CompraLogueada;
  /** Sesión del segundo cliente, sin compra propia (SC-015-N2). */
  sesionB?: Sesion;
  /** Email compartido entre la compra de invitado y la cuenta que se registra después (SC-015-N3). */
  emailCompartido?: string;
  ultimoListado?: OrderHistoryListResponse;
  ultimaRespuesta?: { status: number; body: unknown };
}

function est(w: CatalogWorld): EstadoHistorial {
  w.state.historial ??= {};
  return w.state.historial as EstadoHistorial;
}

async function abrirHistorial(w: CatalogWorld): Promise<void> {
  const e = est(w);
  const res = await e.sesionActiva!.ctx.get('/v1/me/orders');
  e.ultimoListado = (await res.json()) as OrderHistoryListResponse;
}

// ─────────────────────────────────────────────────────────────────────────────
// SC-015-H1 — el listado muestra sólo las compras propias, ordenadas (AC-1, AC-4)
// ─────────────────────────────────────────────────────────────────────────────

Given(
  'un cliente con sesión que compró dos veces estando logueado',
  PASO,
  async function (this: CatalogWorld) {
    const e = est(this);
    const slug = await sembrarProductoPublicado();
    e.compraA = await compraLogueada(slug, '-h1a');
    e.compraA2 = await compraLogueadaConSesion(e.compraA.sesion, slug);
    e.sesionActiva = e.compraA.sesion;
  },
);

Given(
  'otro cliente distinto que también compró estando logueado',
  PASO,
  async function (this: CatalogWorld) {
    const e = est(this);
    const slug = await sembrarProductoPublicado();
    e.compraB = await compraLogueada(slug, '-h1b');
  },
);

When('el primer cliente abre su historial de compras', PASO, async function (this: CatalogWorld) {
  await abrirHistorial(this);
});

Then('ve exactamente sus dos órdenes, con fecha, estado y total en ARS', function (
  this: CatalogWorld,
) {
  const e = est(this);
  assert.equal(
    e.ultimoListado!.data.length,
    2,
    `se esperaban 2 órdenes, hubo ${e.ultimoListado!.data.length}`,
  );
  for (const o of e.ultimoListado!.data) {
    assert.ok(o.created_at, 'falta created_at en una fila del listado');
    assert.ok(o.status, 'falta status en una fila del listado');
    assert.ok(typeof o.total_ars_cents === 'number', 'falta total_ars_cents en una fila del listado');
  }
  const numeros = e.ultimoListado!.data.map((o) => o.order_number).sort();
  const esperados = [e.compraA!.orderNumber, e.compraA2!.orderNumber].sort();
  assert.deepEqual(
    numeros,
    esperados,
    'las órdenes del listado no coinciden con las dos compras sembradas',
  );
});

Then('el listado está ordenado de la más reciente a la más antigua', function (
  this: CatalogWorld,
) {
  const fechas = est(this).ultimoListado!.data.map((o) => new Date(o.created_at).getTime());
  const ordenadasDesc = [...fechas].sort((a, b) => b - a);
  assert.deepEqual(fechas, ordenadasDesc, 'el listado no está ordenado de más reciente a más antigua');
});

Then('no aparece la orden del otro cliente', function (this: CatalogWorld) {
  const e = est(this);
  const presente = e.ultimoListado!.data.some((o) => o.order_number === e.compraB!.orderNumber);
  assert.ok(!presente, `la orden ${e.compraB!.orderNumber} del otro cliente apareció en el listado`);
});

// ─────────────────────────────────────────────────────────────────────────────
// SC-015-H2 — el detalle muestra ítems, cantidades, precios, estado y retiro (AC-2)
// ─────────────────────────────────────────────────────────────────────────────

Given(
  'un cliente con sesión que compró un producto estando logueado',
  PASO,
  async function (this: CatalogWorld) {
    const e = est(this);
    const slug = await sembrarProductoPublicado();
    e.compraA = await compraLogueada(slug, '-h2');
    e.sesionActiva = e.compraA.sesion;
  },
);

When('abre el detalle de esa orden', PASO, async function (this: CatalogWorld) {
  const e = est(this);
  const res = await e.sesionActiva!.ctx.get(`/v1/me/orders/${e.compraA!.orderNumber}`);
  e.ultimaRespuesta = { status: res.status(), body: await res.json().catch(() => undefined) };
});

Then('ve sus ítems con cantidades y precios', function (this: CatalogWorld) {
  const body = est(this).ultimaRespuesta!.body as {
    items?: Array<{ quantity: number; unit_price_ars_cents: number }>;
  };
  assert.equal(est(this).ultimaRespuesta!.status, 200, 'status inesperado al pedir el detalle');
  assert.ok(Array.isArray(body.items) && body.items.length >= 1, 'faltan items en el detalle');
  for (const item of body.items!) {
    assert.ok(item.quantity > 0, 'quantity debería ser > 0');
    assert.ok(item.unit_price_ars_cents > 0, 'unit_price_ars_cents debería ser > 0');
  }
});

Then('ve el estado actual de la orden', function (this: CatalogWorld) {
  const body = est(this).ultimaRespuesta!.body as { status?: string };
  assert.ok(typeof body.status === 'string' && body.status.length > 0, 'falta status en el detalle');
});

Then('ve la modalidad de retiro en sucursal', function (this: CatalogWorld) {
  const body = est(this).ultimaRespuesta!.body as { fulfillment?: string };
  assert.equal(
    body.fulfillment,
    'pickup',
    `fulfillment esperado "pickup", llegó "${body.fulfillment}"`,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// SC-015-A1 — un cliente sin compras ve un listado vacío, sin error (AC-3)
// ─────────────────────────────────────────────────────────────────────────────

Given(
  'un cliente registrado que aún no compró estando logueado',
  PASO,
  async function (this: CatalogWorld) {
    est(this).sesionActiva = await nuevaCuenta('-a1');
  },
);

When('abre su historial', PASO, async function (this: CatalogWorld) {
  await abrirHistorial(this);
});

Then('recibe 200 con un listado vacío', function (this: CatalogWorld) {
  assert.equal(
    est(this).ultimoListado!.data.length,
    0,
    `se esperaba un listado vacío, hubo ${est(this).ultimoListado!.data.length}`,
  );
});

Then('la paginación indica un total de cero', function (this: CatalogWorld) {
  assert.equal(est(this).ultimoListado!.pagination.total, 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// SC-015-C1 — la retención respeta el corte de 12 meses en el borde exacto (AC-7)
// ─────────────────────────────────────────────────────────────────────────────

Given('una compra propia con fecha {string}', PASO, async function (
  this: CatalogWorld,
  antiguedad: string,
) {
  const e = est(this);
  const slug = await sembrarProductoPublicado();
  e.compraA = await compraLogueada(slug, '-c1');
  e.sesionActiva = e.compraA.sesion;
  const id = await idPorOrderNumber(e.compraA.orderNumber);
  await backdatearAlBorde(id, antiguedad === 'exactamente en el corte' ? 'dentro' : 'fuera');
});

When('el cliente abre su historial', PASO, async function (this: CatalogWorld) {
  await abrirHistorial(this);
});

Then('esa compra {string} en el listado', function (this: CatalogWorld, resultado: string) {
  const e = est(this);
  const presente = e.ultimoListado!.data.some((o) => o.order_number === e.compraA!.orderNumber);
  if (resultado === 'aparece') {
    assert.ok(presente, `se esperaba que la orden ${e.compraA!.orderNumber} apareciera en el listado`);
  } else {
    assert.ok(
      !presente,
      `se esperaba que la orden ${e.compraA!.orderNumber} NO apareciera en el listado`,
    );
  }
});

Then('el detalle de esa compra {string}', PASO, async function (
  this: CatalogWorld,
  resultadoDetalle: string,
) {
  const e = est(this);
  const res = await e.sesionActiva!.ctx.get(`/v1/me/orders/${e.compraA!.orderNumber}`);
  if (resultadoDetalle.startsWith('responde 200')) {
    assert.equal(res.status(), 200, `se esperaba 200, llegó ${res.status()}`);
  } else if (resultadoDetalle.startsWith('responde 404')) {
    assert.equal(res.status(), 404, `se esperaba 404, llegó ${res.status()}`);
  } else {
    throw new Error(`[historial-compras.steps] resultado_detalle desconocido: "${resultadoDetalle}"`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// SC-015-C2 — un offset más allá del total devuelve un listado vacío (paginación)
// ─────────────────────────────────────────────────────────────────────────────

Given(
  'un cliente con sesión que compró una vez estando logueado',
  PASO,
  async function (this: CatalogWorld) {
    const e = est(this);
    const slug = await sembrarProductoPublicado();
    e.compraA = await compraLogueada(slug, '-c2c3');
    e.sesionActiva = e.compraA.sesion;
  },
);

When(
  'pide su historial con un offset mayor a la cantidad total de sus compras',
  PASO,
  async function (this: CatalogWorld) {
    const e = est(this);
    const res = await e.sesionActiva!.ctx.get('/v1/me/orders?offset=999');
    e.ultimoListado = (await res.json()) as OrderHistoryListResponse;
  },
);

Then('la paginación conserva el total real de compras', function (this: CatalogWorld) {
  assert.equal(
    est(this).ultimoListado!.pagination.total,
    1,
    `se esperaba total=1, llegó ${est(this).ultimoListado!.pagination.total}`,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// SC-015-C3 — parámetros de paginación inválidos se rechazan sin tocar la base
// ─────────────────────────────────────────────────────────────────────────────
// "Dado un cliente con sesión que compró una vez estando logueado" ya está
// definido arriba (SC-015-C2) — se reusa tal cual.

When('pide su historial con {string} igual a {string}', PASO, async function (
  this: CatalogWorld,
  parametro: string,
  valor: string,
) {
  const e = est(this);
  const qs = new URLSearchParams({ [parametro]: valor }).toString();
  const res = await e.sesionActiva!.ctx.get(`/v1/me/orders?${qs}`);
  e.ultimaRespuesta = { status: res.status(), body: await res.json().catch(() => undefined) };
});

Then('recibe 422 sin exponer ninguna orden', PASO, async function (this: CatalogWorld) {
  const e = est(this);
  assert.equal(
    e.ultimaRespuesta!.status,
    422,
    `se esperaba 422, llegó ${e.ultimaRespuesta!.status}`,
  );
  const body = e.ultimaRespuesta!.body as Record<string, unknown>;
  assert.ok(!('data' in body), 'la respuesta 422 no debería traer "data" (forma de éxito)');
  // Verificación indirecta de que la query nunca se ejecutó: la cuenta sigue
  // con exactamente 1 orden visible con parámetros válidos, después del 422.
  const listado = (await (
    await e.sesionActiva!.ctx.get('/v1/me/orders')
  ).json()) as OrderHistoryListResponse;
  assert.equal(
    listado.pagination.total,
    1,
    `tras el 422, la cuenta debería seguir con 1 orden visible, hubo ${listado.pagination.total}`,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// SC-015-C4 — una compra pending_payment no aparece en el historial (AC-1)
// ─────────────────────────────────────────────────────────────────────────────

Given(
  'un cliente con sesión que inició un checkout sin confirmar el pago',
  PASO,
  async function (this: CatalogWorld) {
    const e = est(this);
    const slug = await sembrarProductoPublicado();
    e.compraA = await compraLogueadaPendiente(slug, '-c4');
    e.sesionActiva = e.compraA.sesion;
  },
);

// "abre su historial" ya está definida arriba (SC-015-A1) — se reusa tal cual.

Then('esa orden no aparece en el listado', function (this: CatalogWorld) {
  assert.equal(
    est(this).ultimoListado!.data.length,
    0,
    `se esperaban 0 órdenes (pending_payment excluida), hubo ${est(this).ultimoListado!.data.length}`,
  );
});

Then('el detalle de esa orden responde 404', PASO, async function (this: CatalogWorld) {
  const e = est(this);
  const res = await e.sesionActiva!.ctx.get(`/v1/me/orders/${e.compraA!.orderNumber}`);
  assert.equal(res.status(), 404, `se esperaba 404, llegó ${res.status()}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// SC-015-C5 — una orden anonimizada a pedido sigue apareciendo intacta
// ─────────────────────────────────────────────────────────────────────────────

Given('una compra propia que el dueño anonimizó a pedido', PASO, async function (
  this: CatalogWorld,
) {
  const e = est(this);
  const slug = await sembrarProductoPublicado();
  e.compraA = await compraLogueada(slug, '-c5');
  e.sesionActiva = e.compraA.sesion;

  // T2.4 (`design.md` §D-QA5): el id interno se resuelve vía GET
  // /v1/admin/orders (US-012, expone `id` en `AdminOrderSummaryDto`), nunca
  // por Prisma acá — a diferencia de SC-015-C1 (T2.1), que sí lo hace por ORM.
  const pagina = await apiCall<{ data: AdminOrderSummary[] }>(
    '/v1/admin/orders?limit=100',
    'GET',
    this.token,
  );
  const fila = pagina.data.find((o) => o.order_number === e.compraA!.orderNumber);
  if (!fila) {
    throw new Error(
      `[historial-compras.steps] la orden #${e.compraA!.orderNumber} no aparece en ` +
        'GET /v1/admin/orders — no se puede resolver su id interno para anonimizarla',
    );
  }
  const r = await dispararAnonimizacion(this, fila.id);
  assert.equal(r.status, 200, `no se pudo anonimizar la orden fixture: ${r.status}`);
});

// "el cliente abre su historial" ya está definida arriba (SC-015-C1) — se reusa tal cual.

Then('esa orden aparece en el listado con su fecha, estado y total sin cambios', function (
  this: CatalogWorld,
) {
  const e = est(this);
  const fila = e.ultimoListado!.data.find((o) => o.order_number === e.compraA!.orderNumber);
  assert.ok(fila, `la orden ${e.compraA!.orderNumber} no aparece en el listado tras anonimizar`);
  assert.equal(
    fila!.total_ars_cents,
    e.compraA!.totalArsCents,
    'total_ars_cents cambió tras anonimizar',
  );
  assert.ok(
    fila!.status && fila!.status !== 'pending_payment',
    `status inesperado tras anonimizar: "${fila!.status}"`,
  );
  assert.ok(fila!.created_at, 'falta created_at tras anonimizar');
});

Then('el detalle de esa orden muestra sus ítems y cantidades sin cambios', PASO, async function (
  this: CatalogWorld,
) {
  const e = est(this);
  const res = await e.sesionActiva!.ctx.get(`/v1/me/orders/${e.compraA!.orderNumber}`);
  assert.equal(res.status(), 200, `se esperaba 200, llegó ${res.status()}`);
  const body = (await res.json()) as {
    items?: Array<{ quantity: number; unit_price_ars_cents: number }>;
  };
  assert.ok(
    Array.isArray(body.items) && body.items.length >= 1,
    'la orden anonimizada perdió sus items',
  );
  for (const item of body.items!) {
    assert.ok(item.quantity > 0, 'quantity no debería ser 0/negativo tras anonimizar');
    assert.ok(item.unit_price_ars_cents > 0, 'unit_price_ars_cents no debería ser 0 tras anonimizar');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// SC-015-N1 — sin sesión de cliente válida, ninguna orden se expone (AC-5)
// ─────────────────────────────────────────────────────────────────────────────

When('un visitante sin sesión pide {string}', PASO, async function (
  this: CatalogWorld,
  endpoint: string,
) {
  const e = est(this);
  const anon = await request.newContext({ baseURL: API });
  const path = endpoint.includes('detalle') ? '/v1/me/orders/1000' : '/v1/me/orders';
  const res = await anon.get(path);
  e.ultimaRespuesta = { status: res.status(), body: await res.json().catch(() => undefined) };
  await anon.dispose();
});

Then('recibe 401', function (this: CatalogWorld) {
  assert.equal(est(this).ultimaRespuesta!.status, 401);
});

Then('la respuesta no contiene ninguna orden', function (this: CatalogWorld) {
  const body = est(this).ultimaRespuesta!.body as Record<string, unknown> | undefined;
  const keys = body ? Object.keys(body) : [];
  assert.ok(
    !keys.includes('data') && !keys.includes('order_number'),
    `la respuesta 401 expone claves de orden: ${JSON.stringify(keys)}`,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// SC-015-N2 — el detalle de una orden ajena responde igual que una inexistente (IDOR)
// ─────────────────────────────────────────────────────────────────────────────

Given('un cliente con sesión que compró estando logueado', PASO, async function (
  this: CatalogWorld,
) {
  const e = est(this);
  const slug = await sembrarProductoPublicado();
  e.compraA = await compraLogueada(slug, '-n2a');
  e.sesionActiva = e.compraA.sesion;
});

Given('otro cliente distinto con sesión propia', PASO, async function (this: CatalogWorld) {
  est(this).sesionB = await nuevaCuenta('-n2b');
});

When('el segundo cliente pide el detalle de la orden del primero', PASO, async function (
  this: CatalogWorld,
) {
  const e = est(this);
  const res = await e.sesionB!.ctx.get(`/v1/me/orders/${e.compraA!.orderNumber}`);
  e.ultimaRespuesta = { status: res.status(), body: await res.json().catch(() => undefined) };
});

Then('recibe 404', function (this: CatalogWorld) {
  assert.equal(est(this).ultimaRespuesta!.status, 404);
});

Then(
  'la respuesta es indistinguible de pedir un número de orden que no existe',
  PASO,
  async function (this: CatalogWorld) {
    const e = est(this);
    const inexistente = await e.sesionB!.ctx.get('/v1/me/orders/999999');
    const bodyInexistente = await inexistente.json().catch(() => undefined);
    assert.equal(
      inexistente.status(),
      e.ultimaRespuesta!.status,
      'el status difiere entre orden ajena e inexistente',
    );
    assert.deepEqual(
      bodyInexistente,
      e.ultimaRespuesta!.body,
      'el cuerpo difiere entre orden ajena e inexistente — filtra que la orden SÍ existe',
    );
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// SC-015-N3 — una compra de invitado con el mismo email no se vincula (AC-6)
// ─────────────────────────────────────────────────────────────────────────────

Given(
  'una compra hecha como invitado con el email de una cuenta que se registra después',
  PASO,
  async function (this: CatalogWorld) {
    const e = est(this);
    const slug = await sembrarProductoPublicado();
    const emailCompartido = `qa-us015-n3-${Date.now()}-${Math.floor(Math.random() * 1e4)}@example.test`;

    const invitado = await nuevoInvitado();
    const alta = await invitado.fijar(slug, 1);
    if (alta.status !== 200) {
      await invitado.cerrar();
      throw new Error(
        `[historial-compras.steps] no se pudo agregar ${slug} x1 al carrito de invitado: ` +
          `${alta.status} ${JSON.stringify(alta.body)}`,
      );
    }
    const checkoutRes = await invitado.checkout(
      buildCheckoutBody({ buyer: buildBuyerData({ email: emailCompartido }) }),
    );
    await invitado.cerrar();
    if (checkoutRes.status !== 201) {
      throw new Error(
        `[historial-compras.steps] POST /v1/checkout (invitado) → ${checkoutRes.status}: ` +
          `${JSON.stringify(checkoutRes.body)}`,
      );
    }
    const confirm = await fetch(`${API}/v1/checkout/simulate-payment`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ order_token: checkoutRes.body.order_token }),
    });
    if (confirm.status !== 200) {
      throw new Error(
        `[historial-compras.steps] simulate-payment (invitado) → ${confirm.status}: ${await confirm.text()}`,
      );
    }
    e.emailCompartido = emailCompartido;
  },
);

When(
  'el dueño de esa cuenta abre su historial con su propia sesión',
  PASO,
  async function (this: CatalogWorld) {
    const e = est(this);
    e.sesionActiva = await registrarCuentaConEmail(e.emailCompartido!);
    await abrirHistorial(this);
  },
);

Then('esa compra de invitado NO aparece en el listado', function (this: CatalogWorld) {
  assert.equal(
    est(this).ultimoListado!.data.length,
    0,
    'la compra de invitado apareció en el historial de la cuenta con el mismo email',
  );
});

Then('sólo aparecen las órdenes que ese cliente hizo estando logueado', function (
  this: CatalogWorld,
) {
  assert.equal(
    est(this).ultimoListado!.pagination.total,
    0,
    'se esperaba total=0 (ninguna compra logueada todavía para esta cuenta)',
  );
});
