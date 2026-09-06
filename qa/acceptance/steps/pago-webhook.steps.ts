import assert from 'node:assert/strict';
import { AfterAll, Given, Then, When } from '@cucumber/cucumber';
// `@dsm/db` es CJS y `@dsm/qa` es ESM: los named exports no son analizables
// estáticamente — mismo patrón que `pago-manual.steps.ts`.
import db from '@dsm/db';
import { apiCall } from '../../support/api';
import { buildCheckoutBody, nuevaCategoria, nuevoProducto } from '../../support/builders';
import { nuevoInvitado } from '../../support/cart-client';
import { esperarAviso, leerLogApi } from '../../support/api-log';
import { backdateOrder, disconnectBackdate } from '../../support/backdate-order';
import {
  firmaConSecretoEquivocado,
  firmaFueraDeVentana,
  firmaValida,
} from '../../support/mercadopago-signature';
import {
  seedPendingPaymentOrder,
  type PendingPaymentOrderSeed,
} from '../../support/seed-pending-payment-order';
import { levantarApiTemporal } from '../../support/spawn-api';
import type { CatalogWorld } from './world';

const { PrismaClient } = db as unknown as { PrismaClient: new () => PrismaLike };
/** Sólo la forma mínima que estos pasos necesitan — evita `any` suelto. */
interface PrismaLike {
  payment: {
    findMany(args: { where: { order_id: string } }): Promise<PagoRegistrado[]>;
    count(args: { where: { status: string; provider: string } }): Promise<number>;
  };
  order: {
    update(args: { where: { id: string }; data: { status: string } }): Promise<unknown>;
  };
  $disconnect(): Promise<void>;
}
interface PagoRegistrado {
  status: string;
  provider: string;
  external_id: string | null;
}

const prisma = new PrismaClient();
AfterAll(async () => {
  await prisma.$disconnect();
  await disconnectBackdate();
});

/**
 * Excepción angosta y documentada (mismo criterio que `pago-manual.steps.ts`,
 * QA-023-F1/QA-010 §4): ningún endpoint HTTP expone la tabla `payments`. Esta
 * lectura vía Prisma se usa SÓLO para asertar, nunca para sembrar.
 */
async function pagosDe(orderId: string): Promise<PagoRegistrado[]> {
  return prisma.payment.findMany({ where: { order_id: orderId } });
}

/** Antigüedad mínima de reconciliación — mismo default que `env.validation.ts`. */
const RECONCILE_MIN_AGE_MS = Number(process.env.RECONCILE_MIN_AGE_MS ?? 300_000);
/** Secreto real del webhook en ESTE entorno de QA — el mismo que `qa-scripts/api-up.sh` exporta. */
const MP_WEBHOOK_SECRET_QA = process.env.MP_WEBHOOK_SECRET ?? '';

interface Estado {
  /** Orden del Antecedentes (Background), sembrada por checkout real. */
  orden?: PendingPaymentOrderSeed;
  /** Última respuesta de una acción de confirmación/webhook/job. */
  ultima?: { status: number; body: unknown };
  /** Las dos respuestas de SC-010-C1 (concurrencia real, misma orden). */
  respuestasConcurrentes?: [
    { status: number; body: unknown },
    { status: number; body: unknown },
  ];
  /** SC-010-C2: producto + N órdenes compitiendo por su última unidad de stock. */
  competencia?: { productId: string; ordenes: PendingPaymentOrderSeed[] };
  /** Respuestas de SC-010-C2 (una por orden). */
  respuestasCompetencia?: Array<{ status: number; body: unknown }>;
  /** Stock leído justo después de la PRIMERA confirmación real (SC-010-N4). */
  stockTrasPrimeraConfirmacion?: number;
  /** Resumen `{scanned,confirmed,stillPending}` / `{cancelled}` / `{attempted,succeeded,failed}` de un job admin. */
  resumenJob?: Record<string, number>;
  /** `dataId` sintético usado en el webhook de SC-010-N1 — no hace falta un pago real de MP. */
  webhookDataId?: string;
}

function est(w: CatalogWorld): Estado {
  return w.state as unknown as Estado;
}

const PASO = { timeout: 60_000 };

// ─────────────────────────────────────────────────────────────────────────────
// Helpers de dominio (medio simulado, jobs admin)
// ─────────────────────────────────────────────────────────────────────────────

/** `POST /v1/checkout/simulate-payment` — autoriza por `order_token`, nunca por JWT (D-QA1/D7). */
async function confirmarSimulado(
  w: CatalogWorld,
  orderToken: string,
): Promise<{ status: number; body: unknown }> {
  const res = await w.anon.post('/v1/checkout/simulate-payment', {
    data: { order_token: orderToken },
  });
  return { status: res.status(), body: await res.json().catch(() => undefined) };
}

/** Los 3 jobs admin (`AdminJobsController`) — sesión admin real del World. */
async function correrJob<T>(w: CatalogWorld, path: string): Promise<T> {
  const res = await w.admin.post(path);
  const body = await res.json().catch(() => undefined);
  if (res.status() !== 200) {
    throw new Error(`${path} → ${res.status()}: ${JSON.stringify(body)}`);
  }
  return body as T;
}

async function stockDe(w: CatalogWorld, productId: string): Promise<number> {
  const dto = await apiCall<{ stock: number }>(
    `/v1/admin/products/${productId}`,
    'GET',
    w.token,
  );
  return dto.stock;
}

/** `GET /pending-payment` es la ÚNICA vía sin 404 para leer una orden que sigue `pending_payment` (`OrdersAdminService.get` la excluye — AC-8). */
async function apareceEnPendientesDePago(w: CatalogWorld, orderId: string): Promise<boolean> {
  const listado = await apiCall<Array<{ id: string }>>(
    '/v1/admin/orders/pending-payment',
    'GET',
    w.token,
  );
  return listado.some((fila) => fila.id === orderId);
}

async function estadoDe(w: CatalogWorld, orderId: string): Promise<string> {
  const dto = await apiCall<{ status: string }>(`/v1/admin/orders/${orderId}`, 'GET', w.token);
  return dto.status;
}

// ─────────────────────────────────────────────────────────────────────────────
// SC-010-H1 / SC-010-N3 / SC-010-N4 — comparten el "Cuando" de confirmación
// ─────────────────────────────────────────────────────────────────────────────

When(
  'se confirma el pago de esa orden por el medio simulado {string}',
  PASO,
  async function (this: CatalogWorld, medio: string) {
    assert.equal(medio, 'DSM', `este paso sólo confirma vía el medio simulado "DSM", se pidió "${medio}"`);
    const e = est(this);
    e.ultima = await confirmarSimulado(this, e.orden!.orderToken);
  },
);

Then('recibo 200 con la orden confirmada', function (this: CatalogWorld) {
  const e = est(this);
  assert.equal(e.ultima?.status, 200, `se esperaba 200, llegó ${e.ultima?.status}`);
  const body = e.ultima?.body as { status?: string; order_number?: number } | undefined;
  assert.equal(body?.status, 'new');
  assert.equal(body?.order_number, e.orden!.orderNumber);
});

Then(
  'queda registrado un pago aprobado para esa orden',
  PASO,
  async function (this: CatalogWorld) {
    const pagos = await pagosDe(est(this).orden!.id);
    assert.equal(pagos.length, 1, `se esperaba exactamente 1 pago, hay ${pagos.length}`);
    assert.equal(pagos[0]!.status, 'approved');
    assert.equal(pagos[0]!.provider, 'simulated_dsm');
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// SC-010-H2 — notificaciones observadas vía el log de `LoggingNotificationAdapter`
// ─────────────────────────────────────────────────────────────────────────────

Then(
  'el puerto de notificaciones recibe exactamente un aviso de confirmación para el comprador',
  PASO,
  async function (this: CatalogWorld) {
    const e = est(this);
    const veces = await esperarAviso('confirmed', e.orden!.id);
    assert.equal(veces, 1, `se esperaba exactamente 1 aviso "order.confirmed" para ${e.orden!.id}, hubo ${veces}`);
  },
);

Then('exactamente un aviso de orden nueva para el dueño', PASO, async function (
  this: CatalogWorld,
) {
  const e = est(this);
  const veces = await esperarAviso('owner_new_order', e.orden!.id);
  assert.equal(veces, 1, `se esperaba exactamente 1 aviso "order.owner_new_order" para ${e.orden!.id}, hubo ${veces}`);
});

Then(
  'ninguno de los dos avisos revela el email del comprador en el registro observable',
  function (this: CatalogWorld) {
    const e = est(this);
    const log = leerLogApi();
    const lineas = log
      .split('\n')
      .filter((l) => l.includes(`order_id=${e.orden!.id}`) && /order\.(confirmed|owner_new_order)/.test(l));
    assert.ok(lineas.length > 0, 'no se encontró ninguna línea de aviso para esta orden en el log');
    for (const linea of lineas) {
      assert.ok(!linea.includes('@'), `una línea de aviso contiene un email: ${linea}`);
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// SC-010-C1 — dos confirmaciones simultáneas, misma orden
// ─────────────────────────────────────────────────────────────────────────────

When(
  'se disparan dos confirmaciones simultáneas para esa orden',
  PASO,
  async function (this: CatalogWorld) {
    const e = est(this);
    const token = e.orden!.orderToken;
    // Dos requests REALES disparados a la vez — nunca `sleep`/timing artificial
    // para simular la carrera (flakiness-detection, señal 5).
    const [a, b] = await Promise.all([
      confirmarSimulado(this, token),
      confirmarSimulado(this, token),
    ]);
    e.respuestasConcurrentes = [a, b];
  },
);

Then('exactamente una responde con éxito', function (this: CatalogWorld) {
  const e = est(this);
  const statuses = e.respuestasConcurrentes!.map((r) => r.status).sort((a, b) => a - b);
  assert.deepEqual(statuses, [200, 409], `se esperaba [200, 409], se obtuvo [${statuses}]`);
});

Then('la otra es rechazada por el estado ya no pendiente', function (this: CatalogWorld) {
  const e = est(this);
  const rechazada = e.respuestasConcurrentes!.find((r) => r.status === 409);
  const body = rechazada?.body as { type?: string } | undefined;
  assert.equal(body?.type, 'dsm:payments/order-not-pending-payment');
});

Then('el stock del producto se decrementó una sola vez', PASO, async function (
  this: CatalogWorld,
) {
  const e = est(this);
  const stock = await stockDe(this, e.orden!.productId);
  assert.equal(stock, e.orden!.stockBefore - e.orden!.quantity);
});

// ─────────────────────────────────────────────────────────────────────────────
// SC-010-C2 — última unidad de stock, varias órdenes distintas
// ─────────────────────────────────────────────────────────────────────────────

const N_ORDENES_COMPETENCIA = 3;

Given(
  'un producto con exactamente una unidad de stock, pedido por varias órdenes distintas',
  PASO,
  async function (this: CatalogWorld) {
    const token = this.token;
    const categoria = await apiCall<{ id: string }>(
      '/v1/admin/categories',
      'POST',
      token,
      nuevaCategoria(),
    );
    const producto = await apiCall<{ id: string; slug: string }>(
      '/v1/admin/products',
      'POST',
      token,
      nuevoProducto(categoria.id, { stock: 1 }),
    );
    await apiCall(`/v1/admin/products/${producto.id}`, 'PATCH', token, { status: 'published' });

    const ordenes: PendingPaymentOrderSeed[] = [];
    for (let i = 0; i < N_ORDENES_COMPETENCIA; i += 1) {
      const invitado = await nuevoInvitado();
      const alta = await invitado.fijar(producto.slug, 1);
      if (alta.status !== 200) {
        await invitado.cerrar();
        throw new Error(
          `[SC-010-C2] no se pudo agregar ${producto.slug} al carrito del invitado ${i}: ${alta.status}`,
        );
      }
      const checkoutRes = await invitado.checkout(buildCheckoutBody());
      await invitado.cerrar();
      if (checkoutRes.status !== 201) {
        throw new Error(
          `[SC-010-C2] checkout del invitado ${i} → ${checkoutRes.status}: ${JSON.stringify(checkoutRes.body)}`,
        );
      }
      ordenes.push({
        id: '',
        orderNumber: checkoutRes.body.order_number,
        buyerName: '',
        totalArsCents: checkoutRes.body.total_ars_cents,
        productId: producto.id,
        productSlug: producto.slug,
        quantity: 1,
        stockBefore: 1,
        orderToken: checkoutRes.body.order_token,
      });
    }

    // Una sola llamada a pending-payment para resolver los N ids (AC-2, mismo
    // criterio que `seed-pending-payment-order.ts`/`confirm-payment.js`).
    const pendientes = await apiCall<Array<{ id: string; order_number: number }>>(
      '/v1/admin/orders/pending-payment',
      'GET',
      token,
    );
    for (const orden of ordenes) {
      const fila = pendientes.find((p) => p.order_number === orden.orderNumber);
      if (!fila) {
        throw new Error(`[SC-010-C2] la orden #${orden.orderNumber} no aparece en pending-payment`);
      }
      orden.id = fila.id;
    }

    est(this).competencia = { productId: producto.id, ordenes };
  },
);

When(
  'se disparan confirmaciones simultáneas para todas esas órdenes',
  PASO,
  async function (this: CatalogWorld) {
    const { ordenes } = est(this).competencia!;
    est(this).respuestasCompetencia = await Promise.all(
      ordenes.map((o) => confirmarSimulado(this, o.orderToken)),
    );
  },
);

Then('exactamente una confirma con éxito', function (this: CatalogWorld) {
  const respuestas = est(this).respuestasCompetencia!;
  const exitosas = respuestas.filter((r) => r.status === 200);
  assert.equal(exitosas.length, 1, `se esperaba exactamente 1 confirmación exitosa, hubo ${exitosas.length}`);
  const rechazadas = respuestas.filter((r) => r.status !== 200);
  assert.equal(rechazadas.length, N_ORDENES_COMPETENCIA - 1);
});

Then('el stock del producto termina en cero, nunca por debajo de cero', PASO, async function (
  this: CatalogWorld,
) {
  const { productId } = est(this).competencia!;
  const stock = await stockDe(this, productId);
  assert.equal(stock, 0, `el stock terminó en ${stock}, se esperaba exactamente 0`);
});

// ─────────────────────────────────────────────────────────────────────────────
// SC-010-C3 — limpieza de abandonadas (backdate + corte de antigüedad)
// ─────────────────────────────────────────────────────────────────────────────

Given('una orden {string} creada hace {string}', PASO, async function (
  this: CatalogWorld,
  estadoEsperado: string,
  antiguedad: string,
) {
  assert.equal(estadoEsperado, 'pending_payment');
  const horas = Number(antiguedad.replace(/[^0-9]/g, ''));
  assert.ok(Number.isFinite(horas) && horas > 0, `no se pudo parsear "${antiguedad}" como horas`);
  await backdateOrder(est(this).orden!.id, horas);
});

When('corre el job de limpieza de abandonadas', PASO, async function (this: CatalogWorld) {
  est(this).resumenJob = await correrJob(this, '/v1/admin/orders/cleanup-abandoned');
});

Then('la orden queda {string}', PASO, async function (this: CatalogWorld, resultado: string) {
  const e = est(this);
  const orderId = e.orden!.id;

  if (resultado === 'cancelled') {
    assert.equal(await estadoDe(this, orderId), 'cancelled');
    return;
  }
  if (resultado === 'cancelada, y deja de aparecer en la cola operativa') {
    assert.equal(await estadoDe(this, orderId), 'cancelled');
    assert.ok(
      !(await apareceEnPendientesDePago(this, orderId)),
      'la orden cancelada sigue en la cola de pendientes de pago',
    );
    return;
  }
  if (resultado === 'intacta en pending_payment') {
    assert.ok(
      await apareceEnPendientesDePago(this, orderId),
      'la orden de 47h ya no aparece como pendiente de pago — el corte de 48h la tocó de más',
    );
    // Limpieza de aislamiento (testing-standards §14 — cada test limpia su
    // propio residuo): esta orden quedó DELIBERADAMENTE `pending_payment` con
    // `created_at` backdateado 47h (T0.2/D-QA5) — si se deja así, envenena la
    // precondición de SC-010-C4 ("ninguna orden pending_payment supera la
    // antigüedad mínima de reconciliación", 5 min) para cualquier escenario
    // que corra después en la MISMA suite. Se cancela acá, después de haber
    // verificado la aserción de ESTE escenario — nunca antes.
    await prisma.order.update({ where: { id: orderId }, data: { status: 'cancelled' } });
    return;
  }
  throw new Error(`resultado desconocido en el Esquema SC-010-C3/N3: "${resultado}"`);
});

// ─────────────────────────────────────────────────────────────────────────────
// SC-010-C4 — reconciliación sin pagos elegibles
// ─────────────────────────────────────────────────────────────────────────────

Given(
  'que ninguna orden {string} supera la antigüedad mínima de reconciliación',
  PASO,
  async function (this: CatalogWorld, estadoEsperado: string) {
    assert.equal(estadoEsperado, 'pending_payment');
    const listado = await apiCall<Array<{ id: string; created_at: string }>>(
      '/v1/admin/orders/pending-payment',
      'GET',
      this.token,
    );
    const corte = Date.now() - RECONCILE_MIN_AGE_MS;
    const vieja = listado.find((o) => new Date(o.created_at).getTime() < corte);
    assert.ok(
      !vieja,
      `hay una orden pending_payment (${vieja?.id}) más vieja que RECONCILE_MIN_AGE_MS=${RECONCILE_MIN_AGE_MS}ms — ` +
        'la precondición de SC-010-C4 no se cumple (¿residuo de una corrida anterior?)',
    );
  },
);

When('corre el job de reconciliación', PASO, async function (this: CatalogWorld) {
  est(this).resumenJob = await correrJob(this, '/v1/admin/payments/reconcile');
});

Then('responde con un resumen de cero órdenes escaneadas y confirmadas', function (
  this: CatalogWorld,
) {
  assert.deepEqual(est(this).resumenJob, { scanned: 0, confirmed: 0, stillPending: 0 });
});

Then('ninguna orden ni pago cambia de estado', PASO, async function (this: CatalogWorld) {
  const e = est(this);
  assert.ok(
    await apareceEnPendientesDePago(this, e.orden!.id),
    'la orden del Antecedentes dejó de estar pending_payment tras reconciliar sin elegibles',
  );
  const pagos = await pagosDe(e.orden!.id);
  assert.equal(pagos.length, 0, `se esperaban 0 pagos, hay ${pagos.length}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// SC-010-N1 — firma inválida (3 variantes), cero escrituras
// ─────────────────────────────────────────────────────────────────────────────

When('llega un webhook {string} para esa orden', PASO, async function (
  this: CatalogWorld,
  variante: string,
) {
  const dataId = `qa-n1-${Date.now()}`;
  est(this).webhookDataId = dataId;
  const requestId = `qa-req-${Date.now()}`;
  const body = { type: 'payment', action: 'payment.updated', data: { id: dataId } };

  let headers: Record<string, string>;
  if (variante === 'con formato correcto pero secreto equivocado') {
    const ts = String(Math.floor(Date.now() / 1000));
    headers = firmaConSecretoEquivocado(MP_WEBHOOK_SECRET_QA, dataId, requestId, ts);
  } else if (variante === 'con el header de firma ausente') {
    headers = { 'x-request-id': requestId };
  } else if (variante === 'con el ts fuera de la ventana de tolerancia') {
    headers = firmaFueraDeVentana(MP_WEBHOOK_SECRET_QA, dataId, requestId, 300);
  } else {
    throw new Error(`variante de firma desconocida en el Esquema SC-010-N1: "${variante}"`);
  }

  const res = await this.anon.post('/v1/webhooks/mercadopago', { data: body, headers });
  est(this).ultima = { status: res.status(), body: await res.json().catch(() => undefined) };
});

Then('recibo {int}', function (this: CatalogWorld, codigo: number) {
  assert.equal(est(this).ultima?.status, codigo, `se esperaba ${codigo}, llegó ${est(this).ultima?.status}`);
});

Then('la orden permanece {string}', PASO, async function (
  this: CatalogWorld,
  estadoEsperado: string,
) {
  assert.equal(
    estadoEsperado,
    'pending_payment',
    `este paso sólo verifica "pending_payment" (vía GET /pending-payment); se pidió "${estadoEsperado}"`,
  );
  assert.ok(
    await apareceEnPendientesDePago(this, est(this).orden!.id),
    'la orden ya no aparece en el listado de pendientes de pago',
  );
});

Then('el stock no se ve afectado', PASO, async function (this: CatalogWorld) {
  const e = est(this);
  const stock = await stockDe(this, e.orden!.productId);
  assert.equal(stock, e.orden!.stockBefore);
});

// ─────────────────────────────────────────────────────────────────────────────
// SC-010-N2 — BLOQUEADO (design.md §D-QA1, hallazgo QA-010-F1). Steps
// bindeados (Strict mode los exige si el escenario llegara a correr) pero
// diseñados para fallar RUIDOSO si alguien corre esta suite sin excluir
// `@blocked` — nunca se simula con un doble no autorizado.
// ─────────────────────────────────────────────────────────────────────────────

When('llega el webhook de un pago rechazado en MercadoPago para esa orden', function () {
  throw new Error(
    'SC-010-N2 BLOQUEADO (design.md §D-QA1, hallazgo QA-010-F1): no hay cuenta sandbox de ' +
      'MercadoPago en este entorno, así que no se puede hacer que `MercadoPagoClient.getPayment` ' +
      'real devuelva status=rejected sin sustituir `baseUrl` (fuera de alcance de este change). ' +
      'Este escenario está tageado `@blocked` — corré la suite con `--tags "... and not @blocked"`.',
  );
});

Then('la orden NO se confirma', function () {
  throw new Error('SC-010-N2 BLOQUEADO — ver el step "Cuando" de este mismo escenario.');
});

// ─────────────────────────────────────────────────────────────────────────────
// SC-010-N3 — reutiliza el Given/When de `pago-manual.steps.ts` (mismo texto:
// "que el stock de un producto de la orden bajó por debajo de lo pedido
// después del checkout" / el "Cuando" de confirmación de arriba).
// ─────────────────────────────────────────────────────────────────────────────

Then('recibo el rechazo por auto-cancelación por falta de stock', function (this: CatalogWorld) {
  const e = est(this);
  assert.equal(e.ultima?.status, 409, `se esperaba 409, llegó ${e.ultima?.status}`);
  const body = e.ultima?.body as { type?: string } | undefined;
  assert.equal(body?.type, 'dsm:payments/auto-cancelled-insufficient-stock');
});

Then('el pago queda reembolsado', PASO, async function (this: CatalogWorld) {
  const pagos = await pagosDe(est(this).orden!.id);
  assert.equal(pagos.length, 1, `se esperaba exactamente 1 pago, hay ${pagos.length}`);
  assert.equal(pagos[0]!.status, 'refunded');
});

Then('el stock del producto no decrementó', PASO, async function (this: CatalogWorld) {
  const e = est(this);
  // Mismo cálculo que el Given reusado de `pago-manual.steps.ts`: el stock se
  // bajó a `quantity - 1` (nunca menos que 0) ANTES de confirmar — acá se
  // recalcula la misma fórmula para comparar, no hay estado propio que leer.
  const bajado = Math.max(0, e.orden!.quantity - 1);
  const stock = await stockDe(this, e.orden!.productId);
  assert.equal(stock, bajado);
});

Then(
  'el puerto de notificaciones recibe exactamente un aviso de cancelación por falta de stock para ese comprador',
  PASO,
  async function (this: CatalogWorld) {
    const e = est(this);
    const veces = await esperarAviso('cancelled_no_stock', e.orden!.id);
    assert.equal(veces, 1, `se esperaba exactamente 1 aviso "order.cancelled_no_stock" para ${e.orden!.id}, hubo ${veces}`);
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// SC-010-N4 — repetir la confirmación de una orden ya confirmada
// ─────────────────────────────────────────────────────────────────────────────

Given('que la orden ya fue confirmada por el medio simulado {string}', PASO, async function (
  this: CatalogWorld,
  medio: string,
) {
  assert.equal(medio, 'DSM');
  const e = est(this);
  const primera = await confirmarSimulado(this, e.orden!.orderToken);
  assert.equal(primera.status, 200, `la primera confirmación falló: ${primera.status}`);
  e.stockTrasPrimeraConfirmacion = await stockDe(this, e.orden!.productId);
});

When('se repite la confirmación de esa misma orden', PASO, async function (this: CatalogWorld) {
  const e = est(this);
  e.ultima = await confirmarSimulado(this, e.orden!.orderToken);
});

Then('recibo el rechazo por estado ya no pendiente', function (this: CatalogWorld) {
  const e = est(this);
  assert.equal(e.ultima?.status, 409, `se esperaba 409, llegó ${e.ultima?.status}`);
  const body = e.ultima?.body as { type?: string } | undefined;
  assert.equal(body?.type, 'dsm:payments/order-not-pending-payment');
});

// "el stock no se decrementa una segunda vez" y "sigue existiendo exactamente
// un pago registrado para esa orden" son EXACTAMENTE el mismo texto que ya
// registra `pago-manual.steps.ts` (SC-023-N1), con la misma semántica sobre
// el mismo `this.state` compartido del World — reuso intencional, no se
// redefinen acá (redefinirlas produce "Multiple step definitions match").

// ─────────────────────────────────────────────────────────────────────────────
// SC-010-N5 — el medio simulado rechaza lo que no debe confirmar (2 variantes)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Puerto dedicado y libre para la instancia temporal — nunca el mismo que la
 * API principal (`QA_API_PORT`, default 3009).
 */
const PUERTO_FLAG_APAGADO = Number(process.env.QA_FLAG_OFF_PORT ?? 3919);
/** Token con la FORMA correcta (64 hex) — el chequeo del flag corre ANTES de resolverlo. */
const TOKEN_HEX_64 = 'a'.repeat(64);

When(
  /^"(el flag del medio simulado está apagado|el order_token no corresponde a ninguna orden real)"$/,
  { timeout: 40_000 },
  async function (this: CatalogWorld, condicion: string) {
    if (condicion === 'el flag del medio simulado está apagado') {
      // Segunda instancia REAL de la misma app compilada, con el flag en su
      // default (`false`) — nunca un doble/mock (`spawn-api.ts`).
      const temporal = await levantarApiTemporal(PUERTO_FLAG_APAGADO, {});
      try {
        const res = await fetch(`${temporal.baseUrl}/v1/checkout/simulate-payment`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ order_token: TOKEN_HEX_64 }),
        });
        est(this).ultima = { status: res.status, body: await res.json().catch(() => undefined) };
      } finally {
        await temporal.stop();
      }
      return;
    }
    if (condicion === 'el order_token no corresponde a ninguna orden real') {
      est(this).ultima = await confirmarSimulado(this, TOKEN_HEX_64);
      return;
    }
    throw new Error(`condición desconocida en el Esquema SC-010-N5: "${condicion}"`);
  },
);

Then('la orden permanece sin cambios', PASO, async function (this: CatalogWorld) {
  const e = est(this);
  assert.ok(
    await apareceEnPendientesDePago(this, e.orden!.id),
    'la orden del Antecedentes ya no aparece como pendiente de pago',
  );
  const stock = await stockDe(this, e.orden!.productId);
  assert.equal(stock, e.orden!.stockBefore, 'el stock cambió aunque la confirmación debía rechazarse');
});

// ─────────────────────────────────────────────────────────────────────────────
// SC-010-N6 — reintento de reembolsos sin pagos elegibles
// ─────────────────────────────────────────────────────────────────────────────

Given(
  'que ningún pago está en {string} para el proveedor MercadoPago',
  PASO,
  async function (this: CatalogWorld, estadoEsperado: string) {
    assert.equal(estadoEsperado, 'refund_pending');
    const count = await prisma.payment.count({
      where: { status: 'refund_pending', provider: 'mercadopago' },
    });
    assert.equal(
      count,
      0,
      `hay ${count} pago(s) refund_pending para mercadopago — la precondición de SC-010-N6 no se cumple`,
    );
  },
);

When('corre el job de reintento de reembolsos', PASO, async function (this: CatalogWorld) {
  est(this).resumenJob = await correrJob(this, '/v1/admin/payments/retry-refunds');
});

Then('responde con un resumen de cero pagos intentados', function (this: CatalogWorld) {
  assert.deepEqual(est(this).resumenJob, { attempted: 0, succeeded: 0, failed: 0 });
});
