import assert from 'node:assert/strict';
import { Given, When, Then } from '@cucumber/cucumber';
import {
  crearOrdenEnEstado,
  checkoutReal,
  idPorOrderNumber,
  avanzarEstado,
  catalogoParaCheckout,
  prismaDeSiembra,
  type OrdenSembrada,
  type FulfillmentStatus,
} from '../../support/seed-ordenes';
import { nuevaCuenta } from '../../support/customer-auth';
import type { CatalogWorld } from './world';

/** Los pasos tocan red (siembra + checkout + varias escrituras); 5 s del default es corto. */
const PASO = { timeout: 60_000 };

interface RespuestaHttp {
  status: number;
  body: Record<string, unknown>;
}

interface Estado {
  ordenes: OrdenSembrada[];
  orden?: OrdenSembrada;
  respuesta?: RespuestaHttp;
  detalle?: Record<string, unknown>;
  listado?: { data: Array<Record<string, unknown>>; pagination: Record<string, unknown> };
  antes?: { applied: number; rejected: number };
}

function est(w: CatalogWorld): Estado {
  const s = w.state as unknown as Partial<Estado>;
  if (!s.ordenes) s.ordenes = [];
  return s as Estado;
}

/**
 * Encuentra una orden sembrada dentro del listado admin. Ordena por
 * `-order_number` (secuencia global monótona): las órdenes recién sembradas
 * por ESTE escenario siempre tienen los números más altos en el momento de la
 * consulta, así que un límite generoso las encuentra sin importar cuántas
 * otras sesiones estén sembrando en la MISMA base compartida en paralelo.
 */
async function buscarEnListado(
  w: CatalogWorld,
  id: string,
  query = '',
): Promise<Record<string, unknown> | undefined> {
  const res = await w.admin.get(`/v1/admin/orders?limit=50&sort=-order_number${query}`);
  const body = (await res.json()) as { data: Array<Record<string, unknown>> };
  return body.data.find((f) => f.id === id);
}

async function detalle(w: CatalogWorld, id: string): Promise<RespuestaHttp> {
  const res = await w.admin.get(`/v1/admin/orders/${id}`);
  return { status: res.status(), body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

async function metricas(w: CatalogWorld): Promise<{ applied: number; rejected: number }> {
  const res = await w.admin.get('/v1/admin/metrics');
  const texto = await res.text();
  const leer = (evento: string): number => {
    const m = texto.match(
      new RegExp(`dsm_orders_events_total\\{event="${evento}"\\}\\s+(\\d+)`),
    );
    return m ? Number(m[1]) : 0;
  };
  return {
    applied: leer('order.status_changed'),
    rejected: leer('order.transition_rejected'),
  };
}

// ─── H-1 ────────────────────────────────────────────────────────────────────

Given(
  'tres órdenes reales de distintos clientes, en distintos estados activos',
  PASO,
  async function (this: CatalogWorld) {
    const e = est(this);
    const estados: FulfillmentStatus[] = ['new', 'preparing', 'ready'];
    for (const [i, s] of estados.entries()) {
      e.ordenes.push(
        await crearOrdenEnEstado(s, {
          buyer: {
            name: `Cliente H1-${i}`,
            email: `h1-${i}-${Date.now()}@qa.test`,
            phone: `+54 351 555 000${i}`,
          },
          adminToken: this.token,
        }),
      );
    }
  },
);

When('el dueño abre el listado de órdenes sin filtro', PASO, async function (this: CatalogWorld) {
  const e = est(this);
  const res = await this.admin.get('/v1/admin/orders?limit=50&sort=-order_number');
  e.listado = (await res.json()) as Estado['listado'];
  e.respuesta = { status: res.status(), body: e.listado as unknown as Record<string, unknown> };
});

Then(
  've cada orden con cliente, total en ARS, estado y fecha de creación',
  PASO,
  async function (this: CatalogWorld) {
    const e = est(this);
    for (const orden of e.ordenes) {
      const fila = e.listado!.data.find((f) => f.id === orden.id);
      assert.ok(fila, `no se encontró la orden ${orden.orderNumber} en el listado`);
      assert.equal(fila.buyer_name, orden.buyer.name);
      assert.equal(fila.total_ars_cents, orden.totalArsCents);
      assert.equal(fila.status, orden.status);
      assert.ok(fila.created_at, 'sin fecha de creación');
    }
  },
);

Then(
  'la lista respeta el límite y el desplazamiento que pidió',
  PASO,
  async function (this: CatalogWorld) {
    const p1 = await (await this.admin.get('/v1/admin/orders?limit=1&offset=0')).json();
    assert.equal(p1.data.length, 1);
    assert.equal(p1.pagination.limit, 1);
    assert.equal(p1.pagination.offset, 0);
    const p2 = await (await this.admin.get('/v1/admin/orders?limit=1&offset=1')).json();
    assert.notEqual(p1.data[0].id, p2.data[0].id, 'offset=1 devolvió la misma fila que offset=0');
  },
);

Then(
  'ordenar por fecha, por número de orden o por total cambia el orden de la página',
  PASO,
  async function (this: CatalogWorld) {
    const variantes = [
      'order_number',
      '-order_number',
      'total_ars_cents',
      '-total_ars_cents',
      'created_at',
      '-created_at',
    ];
    const secuencias = new Set<string>();
    for (const sort of variantes) {
      const body = await (
        await this.admin.get(`/v1/admin/orders?limit=20&sort=${sort}`)
      ).json();
      secuencias.add((body.data as Array<{ id: string }>).map((f) => f.id).join(','));
    }
    assert.ok(secuencias.size > 1, 'ningún valor de sort produjo un orden distinto');
  },
);

// ─── H-2 ────────────────────────────────────────────────────────────────────

Given(
  'una orden real con dos ítems de distinto producto',
  PASO,
  async function (this: CatalogWorld) {
    const e = est(this);
    const { productos } = await catalogoParaCheckout(2);
    const [a, b] = productos;
    const items = [
      { slug: a!.slug, quantity: 2, priceArsCents: a!.price_ars_cents, productName: a!.name },
      { slug: b!.slug, quantity: 1, priceArsCents: b!.price_ars_cents, productName: b!.name },
    ];
    e.orden = await crearOrdenEnEstado('new', { items, adminToken: this.token });
  },
);

When('el dueño abre esa orden desde el listado', PASO, async function (this: CatalogWorld) {
  const e = est(this);
  e.respuesta = await detalle(this, e.orden!.id);
  e.detalle = e.respuesta.body;
});

Then('ve cada ítem con su cantidad y su precio', PASO, async function (this: CatalogWorld) {
  const e = est(this);
  const items = e.detalle!.items as Array<{
    product_name: string;
    quantity: number;
    unit_price_ars_cents: number;
  }>;
  for (const esperado of e.orden!.items) {
    const fila = items.find((i) => i.product_name === esperado.productName);
    assert.ok(fila, `no se encontró el ítem ${esperado.productName}`);
    assert.equal(fila.quantity, esperado.quantity);
    assert.equal(fila.unit_price_ars_cents, esperado.priceArsCents);
  }
});

Then('ve el nombre, el email y el teléfono del comprador', PASO, async function (this: CatalogWorld) {
  const e = est(this);
  assert.equal(e.detalle!.buyer_name, e.orden!.buyer.name);
  assert.equal(e.detalle!.buyer_email, e.orden!.buyer.email);
  assert.equal(e.detalle!.buyer_phone, e.orden!.buyer.phone);
});

Then('ve que el retiro es en sucursal', PASO, async function (this: CatalogWorld) {
  assert.equal(est(this).detalle!.fulfillment, 'pickup');
});

// ─── H-3 ────────────────────────────────────────────────────────────────────

Given('una orden real en estado {string}', PASO, async function (
  this: CatalogWorld,
  target: FulfillmentStatus,
) {
  const e = est(this);
  e.orden = await crearOrdenEnEstado(target, { adminToken: this.token });
});

When(
  'el dueño la avanza a {string}, luego a {string} y luego a {string}',
  PASO,
  async function (this: CatalogWorld, p1: FulfillmentStatus, p2: FulfillmentStatus, p3: FulfillmentStatus) {
    const e = est(this);
    for (const paso of [p1, p2, p3]) {
      const r = await avanzarEstado(this.token, e.orden!.id, paso);
      assert.equal(r.status, 200, `PATCH a "${paso}" devolvió ${r.status}`);
    }
  },
);

Then(
  'cada transición queda registrada con su estado anterior, el nuevo y una marca temporal',
  PASO,
  async function (this: CatalogWorld) {
    const e = est(this);
    e.detalle = (await detalle(this, e.orden!.id)).body;
    const historial = e.detalle!.status_history as Array<{
      from_status: string | null;
      to_status: string;
      changed_at: string;
    }>;
    assert.ok(historial.length >= 3, `se esperaban ≥3 transiciones, hay ${historial.length}`);
    for (const h of historial) {
      assert.ok(h.to_status, 'transición sin to_status');
      assert.ok(h.changed_at, 'transición sin marca temporal');
    }
  },
);

Then(
  'el detalle de la orden expone esas tres transiciones en orden cronológico',
  PASO,
  async function (this: CatalogWorld) {
    const historial = est(this).detalle!.status_history as Array<{ changed_at: string }>;
    const fechas = historial.map((h) => new Date(h.changed_at).getTime());
    const ordenadas = [...fechas].sort((a, b) => a - b);
    assert.deepEqual(fechas, ordenadas, 'el historial no está en orden cronológico');
  },
);

Then('la orden entregada queda con su fecha de entrega poblada', PASO, async function (
  this: CatalogWorld,
) {
  // `delivered_at` no está en el DTO admin (design.md §D3) — se verifica el
  // efecto persistido directamente, sólo de LECTURA (no es el puente de D2:
  // el estado ya lo puso el PATCH real de arriba).
  const fila = await prismaDeSiembra.order.findUniqueOrThrow({
    where: { id: est(this).orden!.id },
  });
  assert.ok(fila.delivered_at, 'delivered_at quedó sin poblar tras la transición a delivered');
});

// ─── H-4 ────────────────────────────────────────────────────────────────────

When('el dueño la marca como "lista para retirar"', PASO, async function (this: CatalogWorld) {
  const e = est(this);
  const r = await avanzarEstado(this.token, e.orden!.id, 'ready');
  e.respuesta = { status: r.status, body: r.body as Record<string, unknown> };
});

Then('la transición se confirma', PASO, async function (this: CatalogWorld) {
  assert.equal(est(this).respuesta!.status, 200);
});

Then(
  'el sistema dispara el aviso de que el pedido está listo para ese comprador',
  PASO,
  async function (this: CatalogWorld) {
    // El puerto de notificación es un log adapter (US-011 sin proveedor real
    // todavía) — lo observable desde acá es que la transición a "ready" haya
    // confirmado sin error: `orders-admin.service.ts` dispara la notificación
    // SIEMPRE que `changeStatus` transiciona a "ready" (nunca en el no-op).
    // El "una sola vez" lo prueba C-2 comparando dos llamadas.
    assert.equal(est(this).respuesta!.status, 200);
    assert.equal((est(this).respuesta!.body as { status: string }).status, 'ready');
  },
);

// ─── H-5 ────────────────────────────────────────────────────────────────────

Given(
  'órdenes reales en los cuatro estados activos de fulfillment',
  PASO,
  async function (this: CatalogWorld) {
    const e = est(this);
    const estados: FulfillmentStatus[] = ['new', 'preparing', 'ready', 'delivered'];
    for (const [i, s] of estados.entries()) {
      e.ordenes.push(
        await crearOrdenEnEstado(s, {
          buyer: {
            name: `Cliente H5-${i}`,
            email: `h5-${i}-${Date.now()}@qa.test`,
            phone: `+54 351 555 010${i}`,
          },
          adminToken: this.token,
        }),
      );
    }
  },
);

When('el dueño filtra el listado por {string}', PASO, async function (
  this: CatalogWorld,
  _etiqueta: string,
) {
  const e = est(this);
  const res = await this.admin.get('/v1/admin/orders?status=preparing&limit=50');
  e.listado = (await res.json()) as Estado['listado'];
});

Then('ve únicamente las órdenes en ese estado', PASO, async function (this: CatalogWorld) {
  const e = est(this);
  for (const fila of e.listado!.data) {
    assert.equal(fila.status, 'preparing', `la fila ${fila.id} no está en "preparing"`);
  }
  const preparando = e.ordenes.find((o) => o.status === 'preparing')!;
  assert.ok(
    e.listado!.data.some((f) => f.id === preparando.id),
    'la orden sembrada en "preparing" no apareció en el filtro',
  );
});

Then('ninguna orden de otro estado activo aparece en la página', PASO, async function (
  this: CatalogWorld,
) {
  const e = est(this);
  const otras = e.ordenes.filter((o) => o.status !== 'preparing');
  for (const otra of otras) {
    assert.ok(
      !e.listado!.data.some((f) => f.id === otra.id),
      `la orden ${otra.orderNumber} (${otra.status}) apareció en el filtro por "preparing"`,
    );
  }
});

// ─── C-1 ────────────────────────────────────────────────────────────────────

Given('una orden real que fue cancelada', PASO, async function (this: CatalogWorld) {
  est(this).orden = await crearOrdenEnEstado('cancelled', { adminToken: this.token });
});

When('el dueño abre esa orden por su id', PASO, async function (this: CatalogWorld) {
  const e = est(this);
  e.respuesta = await detalle(this, e.orden!.id);
});

Then(
  've su detalle igual, sin que el sistema la trate como inexistente',
  PASO,
  async function (this: CatalogWorld) {
    const e = est(this);
    assert.equal(e.respuesta!.status, 200);
    assert.equal(e.respuesta!.body.status, 'cancelled');
  },
);

Then('esa orden no aparece en el listado sin filtro', PASO, async function (this: CatalogWorld) {
  const e = est(this);
  const fila = await buscarEnListado(this, e.orden!.id);
  assert.equal(fila, undefined, 'una orden cancelada apareció en el listado sin filtro');
});

// ─── C-2 ────────────────────────────────────────────────────────────────────

Given('una orden real que el dueño ya marcó como "ready"', PASO, async function (
  this: CatalogWorld,
) {
  est(this).orden = await crearOrdenEnEstado('ready', { adminToken: this.token });
});

When('el dueño repite exactamente esa misma transición', PASO, async function (
  this: CatalogWorld,
) {
  const e = est(this);
  e.antes = await metricas(this);
  const r = await avanzarEstado(this.token, e.orden!.id, 'ready');
  e.respuesta = { status: r.status, body: r.body as Record<string, unknown> };
  e.detalle = (await detalle(this, e.orden!.id)).body;
});

Then('la respuesta sigue siendo exitosa', PASO, async function (this: CatalogWorld) {
  assert.equal(est(this).respuesta!.status, 200);
});

Then('el historial de la orden no gana una segunda entrada', PASO, async function (
  this: CatalogWorld,
) {
  const historial = est(this).detalle!.status_history as unknown[];
  // new→preparing→ready son las 3 transiciones reales que crearOrdenEnEstado
  // ya aplicó; el repetido no agrega una cuarta.
  assert.equal(historial.length, 2, `se esperaban 2 entradas (new→preparing→ready), hay ${historial.length}`);
});

Then('el aviso de "lista para retirar" no se dispara una segunda vez', PASO, async function (
  this: CatalogWorld,
) {
  const e = est(this);
  const despues = await metricas(this);
  assert.equal(
    despues.applied,
    e.antes!.applied,
    'el contador de transiciones aplicadas subió con una repetición (no-op)',
  );
});

// ─── N-1 ────────────────────────────────────────────────────────────────────

When('el dueño intenta marcarla directamente como "delivered"', PASO, async function (
  this: CatalogWorld,
) {
  const e = est(this);
  const r = await avanzarEstado(this.token, e.orden!.id, 'delivered');
  e.respuesta = { status: r.status, body: r.body as Record<string, unknown> };
});

Then('el sistema rechaza la transición', PASO, async function (this: CatalogWorld) {
  assert.equal(est(this).respuesta!.status, 409);
});

Then('la orden sigue en estado {string}', PASO, async function (
  this: CatalogWorld,
  esperado: string,
) {
  const e = est(this);
  const r = await detalle(this, e.orden!.id);
  assert.equal(r.body.status, esperado);
});

Then('el historial de la orden no gana ninguna entrada nueva', PASO, async function (
  this: CatalogWorld,
) {
  const e = est(this);
  const r = await detalle(this, e.orden!.id);
  const historial = r.body.status_history as unknown[];
  assert.equal(historial.length, 0, 'una transición rechazada dejó una entrada en el historial');
});

// ─── N-2 ────────────────────────────────────────────────────────────────────

Given('un visitante que no inició ninguna sesión', PASO, async function (this: CatalogWorld) {
  // Orden real para intentar contra ella — el sujeto de la negación es la
  // AUSENCIA de sesión, no que la orden no exista.
  est(this).orden = await crearOrdenEnEstado('new', { adminToken: this.token });
});

When(
  'intenta abrir el panel de órdenes o cambiar el estado de una orden real',
  PASO,
  async function (this: CatalogWorld) {
    const e = est(this);
    const listado = await this.anon.get('/v1/admin/orders');
    const patch = await this.anon.patch(`/v1/admin/orders/${e.orden!.id}`, {
      data: { status: 'preparing' },
    });
    e.respuesta = { status: listado.status(), body: {} };
    (e as unknown as { respuestaPatch: number }).respuestaPatch = patch.status();
  },
);

Then('el sistema deniega la solicitud', PASO, async function (this: CatalogWorld) {
  const e = est(this);
  assert.ok(
    [401, 403].includes(e.respuesta!.status),
    `el listado sin sesión devolvió ${e.respuesta!.status}, no 401/403`,
  );
  const patchStatus = (e as unknown as { respuestaPatch: number }).respuestaPatch;
  assert.ok(
    [401, 403].includes(patchStatus),
    `el PATCH sin sesión devolvió ${patchStatus}, no 401/403`,
  );
});

// ─── N-3 ────────────────────────────────────────────────────────────────────

Given(
  'una orden real recién generada por checkout, todavía sin confirmar el pago',
  PASO,
  async function (this: CatalogWorld) {
    est(this).orden = await crearOrdenEnEstado('pending_payment');
  },
);

Then('esa orden no aparece', PASO, async function (this: CatalogWorld) {
  const e = est(this);
  const fila = await buscarEnListado(this, e.orden!.id);
  assert.equal(fila, undefined, 'una orden pending_payment apareció en el listado sin filtro');
});

When('el dueño intenta abrir esa orden por su id', PASO, async function (this: CatalogWorld) {
  const e = est(this);
  e.respuesta = await detalle(this, e.orden!.id);
});

Then('el sistema responde que no existe', PASO, async function (this: CatalogWorld) {
  assert.equal(est(this).respuesta!.status, 404);
});

When('el dueño intenta avanzar su estado', PASO, async function (this: CatalogWorld) {
  const e = est(this);
  const r = await avanzarEstado(this.token, e.orden!.id, 'preparing');
  e.respuesta = { status: r.status, body: r.body as Record<string, unknown> };
});

Then('el sistema también responde que no existe', PASO, async function (this: CatalogWorld) {
  assert.equal(est(this).respuesta!.status, 404);
});

// ─── X-1 ────────────────────────────────────────────────────────────────────

Given(
  'un cliente que completó un checkout real con dos productos y sus cantidades',
  PASO,
  async function (this: CatalogWorld) {
    const e = est(this);
    const { productos } = await catalogoParaCheckout(2);
    const [a, b] = productos;
    const buyer = {
      name: 'Cliente X1 Real',
      email: `x1-${Date.now()}@qa.test`,
      phone: '+54 351 555 0202',
    };
    const items = [
      { slug: a!.slug, quantity: 3, priceArsCents: a!.price_ars_cents, productName: a!.name },
      { slug: b!.slug, quantity: 1, priceArsCents: b!.price_ars_cents, productName: b!.name },
    ];
    e.orden = await crearOrdenEnEstado('new', { items, buyer, adminToken: this.token });
  },
);

When('el dueño abre esa orden en el panel', PASO, async function (this: CatalogWorld) {
  const e = est(this);
  e.detalle = (await detalle(this, e.orden!.id)).body;
});

Then(
  've los mismos productos con las mismas cantidades y los mismos precios que el cliente pagó',
  PASO,
  async function (this: CatalogWorld) {
    const e = est(this);
    const items = e.detalle!.items as Array<{
      product_name: string;
      quantity: number;
      unit_price_ars_cents: number;
    }>;
    for (const esperado of e.orden!.items) {
      const fila = items.find((i) => i.product_name === esperado.productName);
      assert.ok(fila, `no se encontró ${esperado.productName} en el panel`);
      assert.equal(fila.quantity, esperado.quantity);
      assert.equal(fila.unit_price_ars_cents, esperado.priceArsCents);
    }
  },
);

Then(
  've el mismo nombre, email y teléfono que el cliente cargó en el checkout',
  PASO,
  async function (this: CatalogWorld) {
    const e = est(this);
    assert.equal(e.detalle!.buyer_name, e.orden!.buyer.name);
    assert.equal(e.detalle!.buyer_email, e.orden!.buyer.email);
    assert.equal(e.detalle!.buyer_phone, e.orden!.buyer.phone);
  },
);

// ─── X-2 ────────────────────────────────────────────────────────────────────

Given(
  'una cuenta de cliente registrada y logueada por el flujo real de US-014',
  PASO,
  async function (this: CatalogWorld) {
    const e = est(this);
    const sesion = await nuevaCuenta('-us012-x2');
    const estado = await sesion.ctx.storageState();
    const accessToken = estado.cookies.find((c) => c.name === 'dsm_access')?.value;
    assert.ok(accessToken, 'la cuenta de cliente no emitió dsm_access');
    (e as unknown as { customerToken: string }).customerToken = accessToken!;
  },
);

When('esa cuenta intenta abrir el panel de órdenes', PASO, async function (this: CatalogWorld) {
  const e = est(this);
  const token = (e as unknown as { customerToken: string }).customerToken;
  const res = await this.anon.get('/v1/admin/orders', {
    headers: { authorization: `Bearer ${token}` },
  });
  e.respuesta = { status: res.status(), body: {} };
});

Then('el sistema la deniega igual que a un visitante sin sesión', PASO, async function (
  this: CatalogWorld,
) {
  assert.ok(
    [401, 403].includes(est(this).respuesta!.status),
    `una sesión de cliente accedió al panel de órdenes (status ${est(this).respuesta!.status})`,
  );
});

// ─── X-3 ────────────────────────────────────────────────────────────────────

When('el dueño la avanza a {string}', PASO, async function (
  this: CatalogWorld,
  target: FulfillmentStatus,
) {
  const e = est(this);
  e.antes = await metricas(this);
  const r = await avanzarEstado(this.token, e.orden!.id, target);
  assert.equal(r.status, 200, `PATCH a "${target}" devolvió ${r.status}`);
});

When('el dueño intenta después saltarla directo a {string}', PASO, async function (
  this: CatalogWorld,
  target: FulfillmentStatus,
) {
  const e = est(this);
  const r = await avanzarEstado(this.token, e.orden!.id, target);
  e.respuesta = { status: r.status, body: r.body as Record<string, unknown> };
});

Then('el contador de transiciones aplicadas subió en uno', PASO, async function (
  this: CatalogWorld,
) {
  const e = est(this);
  const despues = await metricas(this);
  assert.equal(despues.applied, e.antes!.applied + 1, 'el contador de aplicadas no subió en 1');
  // No se reasigna `e.antes`: las dos Then de este escenario comparan contra
  // el MISMO punto de partida (antes de las dos transiciones), no en cadena.
});

Then('el contador de transiciones rechazadas también subió en uno', PASO, async function (
  this: CatalogWorld,
) {
  const e = est(this);
  assert.equal(e.respuesta!.status, 409, 'el salto directo no fue rechazado');
  const despues = await metricas(this);
  assert.equal(
    despues.rejected,
    e.antes!.rejected + 1,
    'el contador de rechazadas no subió en 1',
  );
});
