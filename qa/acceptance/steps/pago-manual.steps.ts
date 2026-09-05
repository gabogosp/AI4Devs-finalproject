import assert from 'node:assert/strict';
import { AfterAll, Given, Then, When } from '@cucumber/cucumber';
import { request } from '@playwright/test';
import jwt from 'jsonwebtoken';
// `@dsm/db` es CJS y `@dsm/qa` es ESM: los named exports no son analizables
// estáticamente — mismo patrón que `qa/performance/seed-load-data.ts`.
import db from '@dsm/db';
import { apiCall } from '../../support/api';
import { QA_API_BASE_URL } from '../../support/qa-env';
import {
  seedPendingPaymentOrder,
  type PendingPaymentOrderSeed,
} from '../../support/seed-pending-payment-order';
import type { CatalogWorld } from './world';

const { PrismaClient } = db as unknown as { PrismaClient: new () => PrismaLike };
/** Sólo la forma mínima que estos pasos necesitan — evita `any` suelto. */
interface PrismaLike {
  payment: {
    findMany(args: { where: { order_id: string } }): Promise<PagoRegistrado[]>;
  };
  order: {
    update(args: {
      where: { id: string };
      data: { status: string };
    }): Promise<unknown>;
  };
  $disconnect(): Promise<void>;
}
interface PagoRegistrado {
  confirmed_by: string | null;
  processed_at: Date | null;
}

const prisma = new PrismaClient();
AfterAll(async () => {
  await prisma.$disconnect();
});

/**
 * Excepción angosta y documentada (mismo criterio que `qa-plan.md` §4, nota de
 * SC-023-N3): **ningún** endpoint HTTP expone la tabla `payments`
 * (hallazgo QA-023-F1) — ni su existencia, ni `confirmed_by`/`processed_at`.
 * Esta lectura vía Prisma se usa SÓLO para asertar, nunca para sembrar: la
 * orden y el pago siempre se crean por la API real (checkout + confirm-payment).
 */
async function pagosDe(orderId: string): Promise<PagoRegistrado[]> {
  return prisma.payment.findMany({ where: { order_id: orderId } });
}

const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-secret';

interface Estado {
  /** Orden del Antecedentes (Background), sembrada por checkout real. */
  orden?: PendingPaymentOrderSeed;
  /** Segunda orden de SC-023-H2. */
  segunda?: PendingPaymentOrderSeed;
  /** Última respuesta de una acción de confirmación. */
  ultima?: { status: number; body: unknown };
  /** Listado de `GET /pending-payment` (SC-023-H2). */
  listado?: Array<Record<string, unknown>>;
  /** Estado previo declarado por el Esquema SC-023-A2, para comparar después. */
  estadoPrevio?: string;
  /** Stock leído justo después de la PRIMERA confirmación real (SC-023-N1). */
  stockTrasPrimeraConfirmacion?: number;
  /** Las dos respuestas de SC-023-N2 (concurrencia real). */
  respuestasConcurrentes?: [
    { status: number; body: unknown },
    { status: number; body: unknown },
  ];
  /** `sub` del JWT usado en SC-023-N3, para comparar contra `confirmed_by`. */
  identidadEsperada?: string;
  /** Marca de tiempo tomada justo antes de confirmar (SC-023-N3). */
  antesDeConfirmar?: number;
  /** El pago leído por `pagosDe` para auditar (SC-023-N3). */
  pagoAuditado?: PagoRegistrado;
}

function est(w: CatalogWorld): Estado {
  return w.state as unknown as Estado;
}

/** Confirma el pago con la sesión admin real del World (`Before` de `world.ts`). */
async function confirmarPago(
  w: CatalogWorld,
  orderId: string,
): Promise<{ status: number; body: unknown }> {
  const res = await w.admin.post(`/v1/admin/orders/${orderId}/confirm-payment`);
  return { status: res.status(), body: await res.json().catch(() => undefined) };
}

/**
 * Confirma el pago SIN la sesión admin del World (SC-023-A1): `undefined` →
 * ningún header `Authorization` (el `this.anon` del World); un token → una
 * sesión válida pero sin `role=admin`.
 */
async function confirmarPagoComo(
  orderId: string,
  w: CatalogWorld,
  tokenNoAdmin: string | undefined,
): Promise<{ status: number; body: unknown }> {
  if (tokenNoAdmin === undefined) {
    const res = await w.anon.post(`/v1/admin/orders/${orderId}/confirm-payment`);
    return { status: res.status(), body: await res.json().catch(() => undefined) };
  }
  const ctx = await request.newContext({
    baseURL: QA_API_BASE_URL,
    extraHTTPHeaders: { authorization: `Bearer ${tokenNoAdmin}` },
  });
  const res = await ctx.post(`/v1/admin/orders/${orderId}/confirm-payment`);
  const salida = { status: res.status(), body: await res.json().catch(() => undefined) };
  await ctx.dispose();
  return salida;
}

async function stockDe(w: CatalogWorld, productId: string): Promise<number> {
  const dto = await apiCall<{ stock: number }>(
    `/v1/admin/products/${productId}`,
    'GET',
    w.token,
  );
  return dto.stock;
}

/** Los tiempos de red de la suite justifican un timeout mayor al default de 5s. */
const PASO = { timeout: 60_000 };

// ─────────────────────────────────────────────────────────────────────────────
// Antecedentes
// ─────────────────────────────────────────────────────────────────────────────

Given('un catálogo sembrado con productos disponibles', function (this: CatalogWorld) {
  // Paso intencionalmente vacío: el catálogo (categoría + producto publicado)
  // se siembra junto con la orden en el próximo paso — `seedPendingPaymentOrder`
  // hace las dos cosas en una sola llamada vía la API real. Separar el Gherkin
  // en dos oraciones documenta la precondición sin sembrar dos veces.
});

Given(
  'un comprador que completó el checkout dejando una orden real en estado {string}',
  PASO,
  async function (this: CatalogWorld, estadoEsperado: string) {
    assert.equal(
      estadoEsperado,
      'pending_payment',
      `este paso sólo siembra "pending_payment", se pidió "${estadoEsperado}"`,
    );
    est(this).orden = await seedPendingPaymentOrder({ qty: 2 });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// SC-023-H1 — happy path
// ─────────────────────────────────────────────────────────────────────────────

When(
  'el dueño autenticado confirma el pago de esa orden',
  PASO,
  async function (this: CatalogWorld) {
    const e = est(this);
    e.ultima = await confirmarPago(this, e.orden!.id);
  },
);

Then('recibe 200 con la orden en estado {string}', function (
  this: CatalogWorld,
  estadoEsperado: string,
) {
  const e = est(this);
  assert.equal(e.ultima?.status, 200, `se esperaba 200, llegó ${e.ultima?.status}`);
  const body = e.ultima?.body as { status?: string } | undefined;
  assert.equal(body?.status, estadoEsperado);
});

Then(
  'el stock de cada producto de la orden queda decrementado exactamente en la cantidad pedida',
  PASO,
  async function (this: CatalogWorld) {
    const e = est(this);
    const stock = await stockDe(this, e.orden!.productId);
    assert.equal(stock, e.orden!.stockBefore - e.orden!.quantity);
  },
);

Then(
  // El "/" en Cucumber Expressions es alternancia ("manual/offline" == "manual" O
  // "offline"), no texto literal — se escapa para matchear la cadena exacta.
  'queda registrado un pago por un medio manual\\/offline para esa orden',
  PASO,
  async function (this: CatalogWorld) {
    const pagos = await pagosDe(est(this).orden!.id);
    assert.equal(pagos.length, 1, `se esperaba exactamente 1 pago, hay ${pagos.length}`);
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// SC-023-H2 — listado de pendientes de pago
// ─────────────────────────────────────────────────────────────────────────────

Given(
  'que existen dos órdenes en estado {string}, la segunda creada después de la primera',
  PASO,
  async function (this: CatalogWorld, estadoEsperado: string) {
    assert.equal(estadoEsperado, 'pending_payment');
    est(this).segunda = await seedPendingPaymentOrder({ qty: 1 });
  },
);

When(
  'se consulta el listado de órdenes pendientes de confirmar pago',
  PASO,
  async function (this: CatalogWorld) {
    est(this).listado = await apiCall<Array<Record<string, unknown>>>(
      '/v1/admin/orders/pending-payment',
      'GET',
      this.token,
    );
  },
);

Then('la respuesta incluye ambas órdenes, la más nueva primero', function (
  this: CatalogWorld,
) {
  const e = est(this);
  const ids = e.listado!.map((fila) => fila.id as string);
  const idxPrimera = ids.indexOf(e.orden!.id);
  const idxSegunda = ids.indexOf(e.segunda!.id);
  assert.notEqual(idxPrimera, -1, 'la primera orden no aparece en el listado');
  assert.notEqual(idxSegunda, -1, 'la segunda orden no aparece en el listado');
  assert.ok(
    idxSegunda < idxPrimera,
    `la orden más nueva (segunda) no aparece antes: índices ${idxSegunda} vs ${idxPrimera}`,
  );
});

Then(
  'cada fila trae el identificador interno de la orden, su número, el nombre del comprador, el total y la fecha de creación',
  function (this: CatalogWorld) {
    for (const fila of est(this).listado!) {
      for (const campo of [
        'id',
        'order_number',
        'buyer_name',
        'total_ars_cents',
        'created_at',
      ]) {
        assert.ok(campo in fila, `falta el campo "${campo}" en una fila del listado`);
      }
    }
  },
);

Then('ninguna fila incluye el email ni el teléfono del comprador', function (
  this: CatalogWorld,
) {
  for (const fila of est(this).listado!) {
    assert.ok(!('buyer_email' in fila), 'una fila expone buyer_email');
    assert.ok(!('buyer_phone' in fila), 'una fila expone buyer_phone');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// SC-023-A1 — sin sesión de dueño
// ─────────────────────────────────────────────────────────────────────────────

When(
  '{string} intenta confirmar el pago de esa orden',
  PASO,
  async function (this: CatalogWorld, quien: string) {
    const e = est(this);
    if (quien === 'nadie (sin token)') {
      e.ultima = await confirmarPagoComo(e.orden!.id, this, undefined);
      return;
    }
    if (quien === 'alguien con sesión no-admin') {
      const tokenNoAdmin = jwt.sign({ role: 'customer', sub: 'qa-sesion-no-admin' }, JWT_SECRET, {
        expiresIn: '1h',
      });
      e.ultima = await confirmarPagoComo(e.orden!.id, this, tokenNoAdmin);
      return;
    }
    throw new Error(`"quién" desconocido en el Esquema SC-023-A1: "${quien}"`);
  },
);

Then('recibe {int}', function (this: CatalogWorld, codigo: number) {
  assert.equal(est(this).ultima?.status, codigo);
});

Then('la orden permanece en {string}', PASO, async function (
  this: CatalogWorld,
  estadoEsperado: string,
) {
  assert.equal(
    estadoEsperado,
    'pending_payment',
    `este paso sólo verifica "pending_payment" (vía GET /pending-payment); se pidió "${estadoEsperado}"`,
  );
  const listado = await apiCall<Array<{ id: string }>>(
    '/v1/admin/orders/pending-payment',
    'GET',
    this.token,
  );
  assert.ok(
    listado.some((fila) => fila.id === est(this).orden!.id),
    'la orden ya no aparece en el listado de pendientes de pago',
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// SC-023-A2 — orden que no está pendiente de pago
// ─────────────────────────────────────────────────────────────────────────────

Given('que la orden ya está en estado {string}', PASO, async function (
  this: CatalogWorld,
  estado: string,
) {
  const e = est(this);
  e.estadoPrevio = estado;
  if (estado === 'new') {
    // Camino real: la misma transición que ejercita SC-023-H1.
    const res = await confirmarPago(this, e.orden!.id);
    assert.equal(res.status, 200, `no se pudo llevar la orden a "new": ${res.status}`);
    return;
  }
  if (estado === 'cancelled') {
    // Excepción angosta y documentada (misma clase que SC-023-N3, ver qa-plan.md
    // §4): HOY no existe ningún endpoint que transicione a "cancelled"
    // (`* → cancelled` es US-013, sin construir — `apps/api/src/orders/order-state.ts`
    // declara sólo 4 estados activos y `orders-admin.service.ts` ni siquiera
    // acepta "cancelled" como target). Sin esta escritura puntual, este único
    // Example de un Esquema ya planificado quedaría sin forma de ejecutarse —
    // se prefiere la excepción angosta y señalada a dejar el escenario en rojo
    // o a mockear la transacción bajo prueba.
    await prisma.order.update({ where: { id: e.orden!.id }, data: { status: 'cancelled' } });
    return;
  }
  throw new Error(`estado desconocido en el Esquema SC-023-A2: "${estado}"`);
});

When('el dueño intenta confirmar su pago', PASO, async function (this: CatalogWorld) {
  const e = est(this);
  e.ultima = await confirmarPago(this, e.orden!.id);
});

Then(
  'recibe 409 con un mensaje claro sobre el estado actual de la orden',
  function (this: CatalogWorld) {
    const e = est(this);
    assert.equal(e.ultima?.status, 409, `se esperaba 409, llegó ${e.ultima?.status}`);
    const body = e.ultima?.body as { type?: string; detail?: string } | undefined;
    assert.equal(body?.type, 'dsm:payments/order-not-pending-payment');
    assert.ok(body?.detail && body.detail.length > 0, 'el 409 no trae un detail legible');
  },
);

Then('el estado de la orden no cambia', PASO, async function (this: CatalogWorld) {
  const e = est(this);
  const dto = await apiCall<{ status: string }>(
    `/v1/admin/orders/${e.orden!.id}`,
    'GET',
    this.token,
  );
  assert.equal(dto.status, e.estadoPrevio);
});

// ─────────────────────────────────────────────────────────────────────────────
// SC-023-N1 — repetir la confirmación (doble click / reintento)
// ─────────────────────────────────────────────────────────────────────────────

Given('que el dueño ya confirmó el pago de esa orden', PASO, async function (
  this: CatalogWorld,
) {
  const e = est(this);
  const primera = await confirmarPago(this, e.orden!.id);
  assert.equal(primera.status, 200, `la primera confirmación falló: ${primera.status}`);
  e.stockTrasPrimeraConfirmacion = await stockDe(this, e.orden!.productId);
});

When('el dueño repite la acción de confirmar', PASO, async function (this: CatalogWorld) {
  const e = est(this);
  e.ultima = await confirmarPago(this, e.orden!.id);
});

Then('el stock no se decrementa una segunda vez', PASO, async function (
  this: CatalogWorld,
) {
  const e = est(this);
  const stock = await stockDe(this, e.orden!.productId);
  assert.equal(stock, e.stockTrasPrimeraConfirmacion);
});

Then(
  'sigue existiendo exactamente un pago registrado para esa orden',
  PASO,
  async function (this: CatalogWorld) {
    const pagos = await pagosDe(est(this).orden!.id);
    assert.equal(pagos.length, 1, `se esperaba exactamente 1 pago, hay ${pagos.length}`);
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// SC-023-N2 — confirmaciones concurrentes reales
// ─────────────────────────────────────────────────────────────────────────────

When(
  'el dueño dispara dos confirmaciones simultáneas sobre la misma orden',
  PASO,
  async function (this: CatalogWorld) {
    const e = est(this);
    const orderId = e.orden!.id;
    // Dos requests REALES disparados a la vez contra el endpoint — nunca
    // `sleep`/timing artificial para simular la carrera (flakiness-detection,
    // señal 5; mismo criterio que el T5.3 dev-owned de `tasks.md`).
    const [a, b] = await Promise.all([
      confirmarPago(this, orderId),
      confirmarPago(this, orderId),
    ]);
    e.respuestasConcurrentes = [a, b];
  },
);

Then(
  'exactamente una responde con éxito y la otra con el rechazo por estado',
  function (this: CatalogWorld) {
    const e = est(this);
    // Se asserta el INVARIANTE agregado (el conjunto ordenado de statuses),
    // nunca "cuál de las dos promesas ganó" — eso sería no-determinista por
    // diseño y produciría un escenario intermitente (flakiness-detection).
    const statuses = e.respuestasConcurrentes!.map((r) => r.status).sort((a, b) => a - b);
    assert.deepEqual(statuses, [200, 409], `se esperaba [200, 409], se obtuvo [${statuses}]`);
  },
);

Then('queda exactamente un pago registrado para esa orden', PASO, async function (
  this: CatalogWorld,
) {
  const pagos = await pagosDe(est(this).orden!.id);
  assert.equal(pagos.length, 1, `se esperaba exactamente 1 pago, hay ${pagos.length}`);
});

Then('el stock quedó decrementado una sola vez', PASO, async function (
  this: CatalogWorld,
) {
  const e = est(this);
  const stock = await stockDe(this, e.orden!.productId);
  assert.equal(stock, e.orden!.stockBefore - e.orden!.quantity);
});

// ─────────────────────────────────────────────────────────────────────────────
// SC-023-N3 — registro auditable
// ─────────────────────────────────────────────────────────────────────────────

Given('que un dueño con identidad conocida confirma el pago de esa orden', PASO, async function (
  this: CatalogWorld,
) {
  const e = est(this);
  const sub = 'qa-auditoria-owner';
  const tokenConocido = jwt.sign({ role: 'admin', sub }, JWT_SECRET, { expiresIn: '1h' });
  e.identidadEsperada = sub;
  e.antesDeConfirmar = Date.now();

  const ctx = await request.newContext({
    baseURL: QA_API_BASE_URL,
    extraHTTPHeaders: { authorization: `Bearer ${tokenConocido}` },
  });
  const res = await ctx.post(`/v1/admin/orders/${e.orden!.id}/confirm-payment`);
  const status = res.status();
  await ctx.dispose();
  assert.equal(status, 200, `no se pudo confirmar con identidad conocida: ${status}`);
});

When('se consulta el registro de auditoría de ese pago', PASO, async function (
  this: CatalogWorld,
) {
  const e = est(this);
  // Excepción angosta y documentada (QA-023-F1, qa-plan.md §4/§12): ningún
  // endpoint HTTP expone `confirmed_by`/`processed_at` hoy. Se usa SÓLO para
  // esta lectura de auditoría — la orden y el pago se sembraron 100% vía API.
  const pagos = await pagosDe(e.orden!.id);
  assert.equal(pagos.length, 1, `se esperaba exactamente 1 pago, hay ${pagos.length}`);
  e.pagoAuditado = pagos[0];
});

Then('el registro identifica a quién confirmó', function (this: CatalogWorld) {
  const e = est(this);
  assert.equal(e.pagoAuditado?.confirmed_by, e.identidadEsperada);
});

Then(
  'el registro tiene una marca temporal dentro de los 5 segundos de la confirmación',
  function (this: CatalogWorld) {
    const e = est(this);
    assert.ok(e.pagoAuditado?.processed_at, 'processed_at es null');
    const ts = e.pagoAuditado!.processed_at!.getTime();
    assert.ok(
      ts >= e.antesDeConfirmar! && ts < e.antesDeConfirmar! + 5000,
      `processed_at fuera de rango: ${e.pagoAuditado!.processed_at!.toISOString()}`,
    );
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// SC-023-N4 — stock insuficiente al confirmar (invariante ADR-0008)
// ─────────────────────────────────────────────────────────────────────────────

Given(
  'que el stock de un producto de la orden bajó por debajo de lo pedido después del checkout',
  PASO,
  async function (this: CatalogWorld) {
    const e = est(this);
    const bajado = Math.max(0, e.orden!.quantity - 1);
    await apiCall(`/v1/admin/products/${e.orden!.productId}`, 'PATCH', this.token, {
      stock: bajado,
    });
  },
);

When('el dueño intenta confirmar el pago', PASO, async function (this: CatalogWorld) {
  const e = est(this);
  e.ultima = await confirmarPago(this, e.orden!.id);
});

Then('recibe 409 señalando que no hay stock suficiente', function (this: CatalogWorld) {
  const e = est(this);
  assert.equal(e.ultima?.status, 409, `se esperaba 409, llegó ${e.ultima?.status}`);
  const body = e.ultima?.body as { type?: string } | undefined;
  assert.equal(body?.type, 'dsm:payments/insufficient-stock');
});

Then('no se registra ningún pago nuevo para esa orden', PASO, async function (
  this: CatalogWorld,
) {
  const pagos = await pagosDe(est(this).orden!.id);
  assert.equal(pagos.length, 0, `se esperaba 0 pagos, hay ${pagos.length}`);
});
