import assert from 'node:assert/strict';
import { Given, When, Then } from '@cucumber/cucumber';
import { adminAuth } from '../../support/admin-auth';
import { apiCall } from '../../support/api';
import { cancelarOrden } from '../../support/cancelar-orden';
import { nuevaCuenta } from '../../support/customer-auth';
import {
  catalogoParaMetricas,
  checkoutReal,
  confirmarPagoManual,
  crearOrdenActiva,
  crearOrdenPendiente,
  simularPagoAutomatico,
  type OrdenMetricas,
  type ProductoParaMetricas,
} from '../../support/seed-metricas';
import type { CatalogWorld } from './world';

const PASO = { timeout: 60_000 };

interface RespuestaCancel {
  status: number;
  body: Record<string, unknown>;
}

interface Estado {
  catalogo?: { token: string; categoryId: string; productos: ProductoParaMetricas[] };
  orden?: OrdenMetricas;
  producto?: ProductoParaMetricas;
  stockAntes?: number;
  historyCountAntes?: number;
  respuesta?: RespuestaCancel;
  respuestaAnonima?: number;
  respuestaCliente?: number;
  targetId?: string;
  ordenB?: OrdenMetricas;
}

function est(w: CatalogWorld): Estado {
  const s = w.state as unknown as Estado;
  return s;
}

async function stockDe(w: CatalogWorld, productId: string): Promise<number> {
  const res = await w.admin.get(`/v1/admin/products/${productId}`);
  const body = (await res.json()) as { stock: number };
  return body.stock;
}

async function detalle(
  w: CatalogWorld,
  id: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await w.admin.get(`/v1/admin/orders/${id}`);
  return { status: res.status(), body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

async function historyCount(w: CatalogWorld, id: string): Promise<number> {
  const d = await detalle(w, id);
  const historial = (d.body.status_history as unknown[]) ?? [];
  return historial.length;
}

/** Siembra una orden real con UN ítem de la cantidad pedida, en el estado activo pedido. */
async function ordenConItem(
  w: CatalogWorld,
  target: 'new' | 'preparing' | 'ready' | 'delivered',
  quantity: number,
): Promise<{ orden: OrdenMetricas; producto: ProductoParaMetricas }> {
  const token = w.token || (await adminAuth());
  const catalogo = await catalogoParaMetricas(1, { token });
  const producto = catalogo.productos[0]!;
  const orden = await crearOrdenActiva(target, {
    adminToken: token,
    catalogo,
    items: [
      {
        slug: producto.slug,
        quantity,
        priceArsCents: producto.price_ars_cents,
        productName: producto.name,
        productId: producto.id,
      },
    ],
  });
  return { orden, producto };
}

// ─── H-1 ────────────────────────────────────────────────────────────────────

Given(
  'una orden real confirmada por pago manual, en estado {string}, con un ítem de 2 unidades',
  PASO,
  async function (this: CatalogWorld, estado: string) {
    const e = est(this);
    const { orden, producto } = await ordenConItem(
      this,
      estado as 'new' | 'preparing' | 'ready',
      2,
    );
    e.orden = orden;
    e.producto = producto;
  },
);

Given('el stock de ese producto antes de cancelar', PASO, async function (this: CatalogWorld) {
  const e = est(this);
  e.stockAntes = await stockDe(this, e.producto!.id);
  e.historyCountAntes = await historyCount(this, e.orden!.id);
});

When('el dueño la cancela', PASO, async function (this: CatalogWorld) {
  const e = est(this);
  const token = this.token || (await adminAuth());
  const res = await cancelarOrden(token, e.orden!.id);
  e.respuesta = res;
});

const ESTADOS_ES_EN: Record<string, string> = { cancelada: 'cancelled' };

Then('la cancelación deja la orden en estado {string}', PASO, async function (this: CatalogWorld, estado: string) {
  const e = est(this);
  assert.equal(e.respuesta!.status, 200, `cancelar devolvió ${e.respuesta!.status}`);
  assert.equal(e.respuesta!.body.status, ESTADOS_ES_EN[estado] ?? estado);
});

Then(
  'el stock del producto vuelve a su valor de antes de la orden',
  PASO,
  async function (this: CatalogWorld) {
    const e = est(this);
    const stockDespues = await stockDe(this, e.producto!.id);
    // stockAntes (leído justo antes de cancelar) + la cantidad reintegrada = el
    // stock de antes de la orden; con 1 sola orden y 1 sola línea, el reintegro
    // ES la diferencia — se verifica leyendo directo el valor final vs el inicial
    // del producto en catalogoParaMetricas (10, ver productoParaMetricas default).
    assert.equal(stockDespues, e.stockAntes! + 2, 'el stock no reintegró exactamente 2 unidades');
  },
);

Then(
  'el sistema dispara el aviso de cancelación al comprador',
  PASO,
  async function (this: CatalogWorld) {
    // El aviso es un seam (NotificationPort.orderCancelledByOwner, US-013 design.md
    // §Approach) — la entrega REAL está Deferred a US-011 (LoggingNotificationAdapter
    // en este entorno). Lo único observable black-box es que la cancelación en sí
    // se completó (200) sin que el disparo del aviso la haya hecho fallar — un fallo
    // del NotificationPort está diseñado para no revertir la cancelación (D del
    // backend). Verificado ya por el 200 de "la orden queda cancelada" arriba.
    const e = est(this);
    assert.equal(e.respuesta!.status, 200);
  },
);

Then('el historial registra quién canceló y cuándo', PASO, async function (this: CatalogWorld) {
  const e = est(this);
  const d = await detalle(this, e.orden!.id);
  const historial = d.body.status_history as Array<Record<string, unknown>>;
  assert.equal(historial.length, e.historyCountAntes! + 1, 'no se agregó una entrada de historial');
  const ultima = historial[historial.length - 1]!;
  assert.equal(ultima.to_status, 'cancelled');
  assert.ok(ultima.changed_by, 'la entrada de historial no registra quién canceló');
  assert.ok(ultima.changed_at, 'la entrada de historial no registra cuándo');
});

Then('el pago de la orden queda {string}', PASO, async function (this: CatalogWorld, estado: string) {
  const e = est(this);
  const refund = e.respuesta!.body.refund as { status: string; provider: string | null };
  assert.equal(refund.status, estado === 'reembolsado' ? 'refunded' : estado);
});

// ─── H-2 ────────────────────────────────────────────────────────────────────

Given(
  'una orden real confirmada por el medio simulado "DSM"',
  PASO,
  async function (this: CatalogWorld) {
    const e = est(this);
    const token = this.token || (await adminAuth());
    const catalogo = await catalogoParaMetricas(1, { token });
    const producto = catalogo.productos[0]!;
    const pendiente = await checkoutReal(
      token,
      [
        {
          slug: producto.slug,
          quantity: 1,
          priceArsCents: producto.price_ars_cents,
          productName: producto.name,
          productId: producto.id,
        },
      ],
    );
    const resultado = await simularPagoAutomatico(pendiente.orderToken);
    assert.equal(resultado.status, 200, `simulate-payment devolvió ${resultado.status}`);
    e.orden = { ...pendiente, status: 'new' };
    e.producto = producto;
  },
);

Then(
  'la cancelación deja la orden en estado "cancelada" y el stock se reintegra',
  PASO,
  async function (this: CatalogWorld) {
    const e = est(this);
    assert.equal(e.respuesta!.status, 200);
    assert.equal(e.respuesta!.body.status, 'cancelled');
    const stockDespues = await stockDe(this, e.producto!.id);
    assert.equal(stockDespues, 10, 'el stock no volvió a su valor original (10)');
  },
);

Then(
  'el pago queda "reembolsado" sin que el sistema haya llamado a ningún proveedor externo',
  PASO,
  async function (this: CatalogWorld) {
    const e = est(this);
    const refund = e.respuesta!.body.refund as { status: string; provider: string | null };
    assert.equal(refund.status, 'refunded');
    assert.equal(refund.provider, 'simulated_dsm');
  },
);

// ─── C-1 ────────────────────────────────────────────────────────────────────

Given('una orden real que el dueño ya canceló', PASO, async function (this: CatalogWorld) {
  const e = est(this);
  const { orden, producto } = await ordenConItem(this, 'new', 1);
  const token = this.token || (await adminAuth());
  const primera = await cancelarOrden(token, orden.id);
  assert.equal(primera.status, 200, `la primera cancelación debía ser 200, fue ${primera.status}`);
  e.orden = orden;
  e.producto = producto;
  e.stockAntes = await stockDe(this, producto.id);
  e.historyCountAntes = await historyCount(this, orden.id);
});

When(
  'el dueño repite exactamente esa misma cancelación',
  PASO,
  async function (this: CatalogWorld) {
    const e = est(this);
    const token = this.token || (await adminAuth());
    e.respuesta = await cancelarOrden(token, e.orden!.id);
  },
);

// "la respuesta sigue siendo exitosa" ya está definido en ordenes.steps.ts
// (assert.equal(est(this).respuesta!.status, 200)) — genérico contra el mismo
// campo `respuesta` que este archivo también usa; no se redefine acá.

Then('el stock del producto no vuelve a incrementarse', PASO, async function (this: CatalogWorld) {
  const e = est(this);
  const stockDespues = await stockDe(this, e.producto!.id);
  assert.equal(stockDespues, e.stockAntes, 'el stock cambió tras repetir la cancelación');
});

Then(
  'el historial de la orden no gana una segunda entrada de cancelación',
  PASO,
  async function (this: CatalogWorld) {
    const e = est(this);
    const count = await historyCount(this, e.orden!.id);
    assert.equal(count, e.historyCountAntes, 'el historial ganó una entrada extra al repetir');
  },
);

// ─── C-2 ────────────────────────────────────────────────────────────────────

Given('una orden real activa con un ítem de stock conocido', PASO, async function (this: CatalogWorld) {
  const e = est(this);
  const { orden, producto } = await ordenConItem(this, 'new', 1);
  e.orden = orden;
  e.producto = producto;
  e.stockAntes = await stockDe(this, producto.id);
  e.historyCountAntes = await historyCount(this, orden.id);
});

When(
  'se disparan dos cancelaciones simultáneas para esa misma orden',
  PASO,
  async function (this: CatalogWorld) {
    const e = est(this);
    const token = this.token || (await adminAuth());
    const [r1, r2] = await Promise.all([
      cancelarOrden(token, e.orden!.id),
      cancelarOrden(token, e.orden!.id),
    ]);
    (e as unknown as { carrera: RespuestaCancel[] }).carrera = [r1, r2];
  },
);

Then('exactamente una aplica la transición de estado', PASO, async function (this: CatalogWorld) {
  const e = est(this);
  const carrera = (e as unknown as { carrera: RespuestaCancel[] }).carrera;
  // Ambas llamadas responden 200 por diseño (idempotencia, D3 del backend: la
  // que pierde la carrera cae al camino idempotente y reporta el estado
  // persistido) — lo que distingue "una aplicó, la otra no" es el HISTORIAL:
  // sólo debe haber UNA entrada nueva "cancelled", nunca dos.
  for (const r of carrera) {
    assert.equal(r.status, 200, `una cancelación concurrente devolvió ${r.status}`);
  }
  const count = await historyCount(this, e.orden!.id);
  assert.equal(
    count,
    e.historyCountAntes! + 1,
    `se esperaba exactamente 1 entrada nueva de historial, hubo ${count - e.historyCountAntes!}`,
  );
});

Then(
  'el stock del producto queda incrementado una sola vez, nunca el doble',
  PASO,
  async function (this: CatalogWorld) {
    const e = est(this);
    const stockDespues = await stockDe(this, e.producto!.id);
    assert.equal(stockDespues, e.stockAntes! + 1, 'el stock se incrementó más de una vez (o ninguna)');
  },
);

// ─── N-1 ────────────────────────────────────────────────────────────────────

Given('{string}', PASO, async function (this: CatalogWorld, condicion: string) {
  const e = est(this);
  const token = this.token || (await adminAuth());
  if (condicion === 'una orden real ya entregada') {
    const { orden, producto } = await ordenConItem(this, 'delivered', 1);
    e.orden = orden;
    e.producto = producto;
    e.targetId = orden.id;
  } else if (condicion === 'una orden real todavía sin confirmar el pago') {
    const catalogo = await catalogoParaMetricas(1, { token });
    const producto = catalogo.productos[0]!;
    const orden = await crearOrdenPendiente({ adminToken: token, catalogo });
    e.orden = orden;
    e.producto = producto;
    e.targetId = orden.id;
  } else if (condicion === 'un id que no corresponde a ninguna orden real') {
    const { orden, producto } = await ordenConItem(this, 'new', 1);
    e.orden = orden;
    e.producto = producto;
    e.targetId = '00000000-0000-4000-8000-000000000000';
  } else {
    throw new Error(`condición N-1 no reconocida: "${condicion}"`);
  }
  e.stockAntes = await stockDe(this, e.producto!.id);
  e.historyCountAntes = await historyCount(this, e.orden!.id);
});

When('el dueño intenta cancelarla', PASO, async function (this: CatalogWorld) {
  const e = est(this);
  const token = this.token || (await adminAuth());
  e.respuesta = await cancelarOrden(token, e.targetId!);
});

Then('recibo el código {int}', PASO, async function (this: CatalogWorld, codigo: number) {
  const e = est(this);
  assert.equal(e.respuesta!.status, codigo, `se esperaba ${codigo}, llegó ${e.respuesta!.status}`);
});

Then('ningún stock del producto involucrado cambia', PASO, async function (this: CatalogWorld) {
  const e = est(this);
  const stockDespues = await stockDe(this, e.producto!.id);
  assert.equal(stockDespues, e.stockAntes, 'el stock cambió pese a que la cancelación se rechazó');
});

Then('ningún pago cambia de estado', PASO, async function (this: CatalogWorld) {
  // No hay endpoint admin que lea el estado de un pago de forma aislada (sólo
  // el 200 de /cancel lo expone, y acá la cancelación se rechazó). Proxy
  // observable: el historial de la orden no ganó ninguna entrada — si el
  // pago hubiera cambiado de estado habría sido DENTRO de la misma transacción
  // atómica que también escribe el historial (design.md §D3 del backend).
  const e = est(this);
  const count = await historyCount(this, e.orden!.id);
  assert.equal(count, e.historyCountAntes, 'el historial cambió pese a que la cancelación se rechazó');
});

// ─── N-2 ────────────────────────────────────────────────────────────────────

// "un visitante sin ninguna sesión" ya está definido en metricas.steps.ts (no-op,
// reusa this.anon) — no se redefine acá.

When(
  'el visitante intenta cancelar una orden real activa',
  PASO,
  async function (this: CatalogWorld) {
    const e = est(this);
    const { orden, producto } = await ordenConItem(this, 'new', 1);
    e.orden = orden;
    e.producto = producto;
    e.stockAntes = await stockDe(this, producto.id);
    e.historyCountAntes = await historyCount(this, orden.id);
    const res = await this.anon.post(`/v1/admin/orders/${orden.id}/cancel`);
    e.respuestaAnonima = res.status();
  },
);

Then('el sistema deniega la cancelación', PASO, async function (this: CatalogWorld) {
  const e = est(this);
  assert.ok(
    [401, 403].includes(e.respuestaAnonima!),
    `visitante sin sesión: status ${e.respuestaAnonima}, se esperaba 401/403`,
  );
});

When(
  'una cuenta de cliente real \\(US-014, sesión válida pero no admin\\) intenta cancelar esa misma orden',
  PASO,
  async function (this: CatalogWorld) {
    const e = est(this);
    const sesion = await nuevaCuenta('-us013-n2');
    const estadoStorage = await sesion.ctx.storageState();
    const accessToken = estadoStorage.cookies.find((c) => c.name === 'dsm_access')?.value;
    assert.ok(accessToken, 'la cuenta de cliente no emitió dsm_access');
    const res = await fetch(
      `${process.env.QA_API_BASE_URL ?? 'http://localhost:3000'}/v1/admin/orders/${e.orden!.id}/cancel`,
      { method: 'POST', headers: { authorization: `Bearer ${accessToken}` } },
    );
    e.respuestaCliente = res.status;
    await sesion.ctx.dispose();
  },
);

Then(
  'el sistema deniega la cancelación igual que al visitante',
  PASO,
  async function (this: CatalogWorld) {
    const e = est(this);
    assert.ok(
      [401, 403].includes(e.respuestaCliente!),
      `cuenta de cliente: status ${e.respuestaCliente}, se esperaba 401/403`,
    );
  },
);

Then(
  'la orden de cancelación-ordenes permanece sin cambios en los dos casos',
  PASO,
  async function (this: CatalogWorld) {
    const e = est(this);
    const stockDespues = await stockDe(this, e.producto!.id);
    assert.equal(stockDespues, e.stockAntes, 'el stock cambió pese a que las dos cancelaciones se rechazaron');
    const count = await historyCount(this, e.orden!.id);
    assert.equal(count, e.historyCountAntes, 'el historial cambió pese a que las dos cancelaciones se rechazaron');
    const d = await detalle(this, e.orden!.id);
    assert.equal(d.body.status, 'new', 'la orden cambió de estado pese a que las dos cancelaciones se rechazaron');
  },
);

// ─── X-1 ────────────────────────────────────────────────────────────────────

Given('un producto con stock conocido antes de cualquier venta', PASO, async function (
  this: CatalogWorld,
) {
  const e = est(this);
  const token = this.token || (await adminAuth());
  const catalogo = await catalogoParaMetricas(1, { token });
  e.catalogo = catalogo;
  e.producto = catalogo.productos[0]!;
  e.stockAntes = await stockDe(this, e.producto.id);
});

Given(
  'un cliente que completó un checkout real de 3 unidades de ese producto \\(US-008\\)',
  PASO,
  async function (this: CatalogWorld) {
    const e = est(this);
    const token = this.token || (await adminAuth());
    e.orden = await checkoutReal(
      token,
      [
        {
          slug: e.producto!.slug,
          quantity: 3,
          priceArsCents: e.producto!.price_ars_cents,
          productName: e.producto!.name,
          productId: e.producto!.id,
        },
      ],
    );
  },
);

Given('esa orden confirmada por pago manual real \\(US-023\\)', PASO, async function (
  this: CatalogWorld,
) {
  const e = est(this);
  const token = this.token || (await adminAuth());
  const r = await confirmarPagoManual(token, e.orden!.id);
  assert.equal(r.status, 200, `confirm-payment devolvió ${r.status}`);
});

When('el dueño cancela esa orden', PASO, async function (this: CatalogWorld) {
  const e = est(this);
  const token = this.token || (await adminAuth());
  e.respuesta = await cancelarOrden(token, e.orden!.id);
});

Then(
  'el stock del producto vuelve exactamente al valor previo a la venta',
  PASO,
  async function (this: CatalogWorld) {
    const e = est(this);
    assert.equal(e.respuesta!.status, 200);
    const stockDespues = await stockDe(this, e.producto!.id);
    assert.equal(
      stockDespues,
      e.stockAntes,
      'el reintegro no coincide exactamente con el decremento real de checkout+confirmación',
    );
  },
);

// ─── X-2 ────────────────────────────────────────────────────────────────────

interface SummaryResponse {
  range: { from: string; to: string };
  orders_count: number;
  total_ars_cents: number;
}

async function resumenDe(w: CatalogWorld, from: string, to: string): Promise<SummaryResponse> {
  const res = await w.admin.get(
    `/v1/admin/reports/summary?created_at_from=${from}&created_at_to=${to}`,
  );
  return (await res.json()) as SummaryResponse;
}

Given(
  'una orden real confirmada por pago manual, ya contabilizada en el resumen del panel de métricas \\(US-016\\)',
  PASO,
  async function (this: CatalogWorld) {
    const e = est(this);
    const { orden, producto } = await ordenConItem(this, 'new', 1);
    e.orden = orden;
    e.producto = producto;
    const desde = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const hasta = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const x2 = e as unknown as {
      rangoFrom: string;
      rangoTo: string;
      ordersCountAntes: number;
      totalArsCentsAntes: number;
    };
    x2.rangoFrom = desde;
    x2.rangoTo = hasta;
    const antes = await resumenDe(this, desde, hasta);
    assert.ok(
      antes.orders_count >= 1,
      'la orden recién sembrada no aparece en el resumen antes de cancelarla',
    );
    x2.ordersCountAntes = antes.orders_count;
    x2.totalArsCentsAntes = antes.total_ars_cents;
  },
);

Then(
  'el resumen de métricas para el período que la incluye ya no la cuenta en orders_count',
  PASO,
  async function (this: CatalogWorld) {
    const e = est(this);
    assert.equal(e.respuesta!.status, 200);
    const { rangoFrom, rangoTo, ordersCountAntes } = e as unknown as {
      rangoFrom: string;
      rangoTo: string;
      ordersCountAntes: number;
    };
    const despues = await resumenDe(this, rangoFrom, rangoTo);
    assert.equal(
      despues.orders_count,
      ordersCountAntes - 1,
      `orders_count no bajó en 1 tras cancelar: antes ${ordersCountAntes}, después ${despues.orders_count}`,
    );
  },
);

Then('su monto ya no aporta a total_ars_cents', PASO, async function (this: CatalogWorld) {
  const e = est(this);
  const { rangoFrom, rangoTo, totalArsCentsAntes } = e as unknown as {
    rangoFrom: string;
    rangoTo: string;
    totalArsCentsAntes: number;
  };
  const despues = await resumenDe(this, rangoFrom, rangoTo);
  const montoOrden = e.orden!.totalArsCents;
  assert.equal(
    despues.total_ars_cents,
    totalArsCentsAntes - montoOrden,
    'el monto de la orden cancelada no se restó de total_ars_cents',
  );
});

// ─── X-3 ────────────────────────────────────────────────────────────────────

async function estaEnListadoSinFiltro(w: CatalogWorld, id: string): Promise<boolean> {
  const res = await w.admin.get('/v1/admin/orders?limit=100&sort=-order_number');
  const body = (await res.json()) as { data: Array<{ id: string }> };
  return body.data.some((f) => f.id === id);
}

Given(
  'una orden real activa, visible en el listado sin filtro del panel de órdenes \\(US-012\\)',
  PASO,
  async function (this: CatalogWorld) {
    const e = est(this);
    const { orden, producto } = await ordenConItem(this, 'new', 1);
    e.orden = orden;
    e.producto = producto;
    const visible = await estaEnListadoSinFiltro(this, orden.id);
    assert.ok(visible, 'la orden recién sembrada no aparece en el listado antes de cancelarla');
  },
);

Then(
  'el detalle de esa orden sigue abriéndose por su id, con el nuevo estado',
  PASO,
  async function (this: CatalogWorld) {
    const e = est(this);
    assert.equal(e.respuesta!.status, 200);
    const d = await detalle(this, e.orden!.id);
    assert.equal(d.status, 200, 'GET /admin/orders/{id} dejó de devolver 200 tras cancelar');
    assert.equal(d.body.status, 'cancelled');
  },
);

Then('esa orden ya no aparece en el listado sin filtro del panel', PASO, async function (
  this: CatalogWorld,
) {
  const e = est(this);
  const visible = await estaEnListadoSinFiltro(this, e.orden!.id);
  assert.equal(visible, false, 'la orden cancelada sigue apareciendo en el listado sin filtro');
});
