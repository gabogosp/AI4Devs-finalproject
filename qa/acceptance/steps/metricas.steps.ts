import assert from 'node:assert/strict';
import { Given, When, Then } from '@cucumber/cucumber';
import {
  catalogoParaMetricas,
  crearOrdenActiva,
  crearOrdenCanceladaPorStock,
  crearOrdenPendiente,
  backdatearCreatedAt,
  type OrdenMetricas,
  type ProductoParaMetricas,
} from '../../support/seed-metricas';
import { apiCall } from '../../support/api';
import { nuevaCuenta } from '../../support/customer-auth';
import type { CatalogWorld } from './world';

/** Las escrituras de este archivo son varias por paso (siembra + checkout + PATCH). */
const PASO = { timeout: 60_000 };

const SALE_STATUSES = ['new', 'preparing', 'ready', 'delivered'] as const;
const REPORTS_ENDPOINTS = [
  'sales',
  'sales/export',
  'top-products',
  'top-products/export',
  'summary',
  'summary/export',
];

interface SalesRow {
  period_date: string;
  orders_count: number;
  total_ars_cents: number;
}
interface SalesResponse {
  range: { from: string; to: string };
  granularity: string;
  data: SalesRow[];
}
interface TopProductsRow {
  product_id: string;
  product_name: string;
  product_sku: string;
  quantity_sold: number;
  revenue_ars_cents: number;
}
interface TopProductsResponse {
  range: { from: string; to: string };
  data: TopProductsRow[];
}
interface SummaryResponse {
  range: { from: string; to: string };
  orders_count: number;
  total_ars_cents: number;
  breakdown_by_status: Record<string, { count: number; total_ars_cents: number }>;
}

interface Estado {
  catalogo?: { token: string; categoryId: string; productos: ProductoParaMetricas[] };
  orden?: OrdenMetricas;
  ordenes?: OrdenMetricas[];
  desde?: string;
  hasta?: string;
  sales?: { status: number; body: SalesResponse };
  topProducts?: { status: number; body: TopProductsResponse };
  summary?: { status: number; body: SummaryResponse };
  salesDefault?: { status: number; body: SalesResponse };
  topProductsDefault?: { status: number; body: TopProductsResponse };
  summaryDefault?: { status: number; body: SummaryResponse };
  salesWide?: { status: number; body: SalesResponse };
  topProductsWide?: { status: number; body: TopProductsResponse };
  summaryWide?: { status: number; body: SummaryResponse };
  respuestasDenegadas?: Array<{ path: string; status: number }>;
  respuestasClienteDenegadas?: Array<{ path: string; status: number }>;
  csvSales?: { status: number; text: string; headers: Record<string, string> };
  csvTopProducts?: { status: number; text: string; headers: Record<string, string> };
  csvSummary?: { status: number; text: string; headers: Record<string, string> };
  productoRenombrado?: ProductoParaMetricas;
  nombreOriginal?: string;
}

function est(w: CatalogWorld): Estado {
  const s = w.state as unknown as Estado;
  return s;
}

async function metricaJson<T>(
  w: CatalogWorld,
  endpoint: string,
  qs = '',
): Promise<{ status: number; body: T }> {
  const res = await w.admin.get(`/v1/admin/reports/${endpoint}${qs}`);
  return { status: res.status(), body: (await res.json().catch(() => ({}))) as T };
}

async function metricaCsv(
  w: CatalogWorld,
  endpoint: string,
  qs = '',
): Promise<{ status: number; text: string; headers: Record<string, string> }> {
  const res = await w.admin.get(`/v1/admin/reports/${endpoint}/export${qs}`);
  return { status: res.status(), text: await res.text(), headers: res.headers() };
}

function rangoQs(from?: string, to?: string): string {
  const params = new URLSearchParams();
  if (from) params.set('created_at_from', from);
  if (to) params.set('created_at_to', to);
  const s = params.toString();
  return s ? `?${s}` : '';
}

// ─── H-1 ────────────────────────────────────────────────────────────────────

Given('un catálogo con dos productos publicados', PASO, async function (this: CatalogWorld) {
  const e = est(this);
  e.catalogo = await catalogoParaMetricas(2, { token: this.token });
  // Línea de base ANTES de sembrar, con el mismo "sin especificar rango" que
  // el When de este escenario usa — esta base descartable no está pristina
  // (el smoke de seed-metricas y el contract test ya corrieron antes en la
  // misma corrida y sembraron órdenes "de hoy"), así que las Then comparan
  // por DELTA contra esta línea de base, nunca por conteo absoluto
  // (`testing-standards.md` §5 — aislamiento de datos de test).
  e.salesDefault = await metricaJson<SalesResponse>(this, 'sales');
  e.summaryDefault = await metricaJson<SummaryResponse>(this, 'summary');
});

Given(
  'tres órdenes reales confirmadas por pago, en distintos días del último mes',
  PASO,
  async function (this: CatalogWorld) {
    // Las tres nacen el mismo día real (no se reutiliza acá el backdate de
    // AC-9 — reservado a H-2/QA-016-E2E-5, qa-plan.md §6): las Then de este
    // escenario no exigen múltiples días, sólo que el DELTA de la fila del
    // día con órdenes sume correctamente y que los tres widgets coincidan.
    const e = est(this);
    const c = e.catalogo!;
    const items = [
      { slug: c.productos[0]!.slug, quantity: 1, priceArsCents: c.productos[0]!.price_ars_cents, productName: c.productos[0]!.name, productId: c.productos[0]!.id },
      { slug: c.productos[1]!.slug, quantity: 2, priceArsCents: c.productos[1]!.price_ars_cents, productName: c.productos[1]!.name, productId: c.productos[1]!.id },
    ];
    e.ordenes = [
      await crearOrdenActiva('new', { adminToken: this.token, catalogo: c, items: [items[0]!] }),
      await crearOrdenActiva('new', { adminToken: this.token, catalogo: c, items: [items[1]!] }),
      await crearOrdenActiva('new', { adminToken: this.token, catalogo: c, items: [items[0]!, items[1]!] }),
    ];
  },
);

When('el dueño consulta las tres métricas sin especificar rango', PASO, async function (
  this: CatalogWorld,
) {
  const e = est(this);
  e.sales = await metricaJson<SalesResponse>(this, 'sales');
  e.topProducts = await metricaJson<TopProductsResponse>(this, 'top-products');
  e.summary = await metricaJson<SummaryResponse>(this, 'summary');
});

function filaDelDia(body: SalesResponse, dia: string): number {
  return body.data.find((r) => r.period_date === dia)?.orders_count ?? 0;
}

Then(
  'la evolución de ventas incluye una fila por cada día con al menos una orden',
  function (this: CatalogWorld) {
    const e = est(this);
    assert.equal(e.sales!.status, 200);
    const hoy = new Date().toISOString().slice(0, 10);
    const antes = filaDelDia(e.salesDefault!.body, hoy);
    const despues = filaDelDia(e.sales!.body, hoy);
    assert.equal(despues - antes, e.ordenes!.length, 'el DELTA de la fila de hoy no suma las 3 órdenes sembradas');
  },
);

Then(
  'el ranking de productos muestra cada producto con la cantidad realmente vendida',
  function (this: CatalogWorld) {
    const e = est(this);
    assert.equal(e.topProducts!.status, 200);
    const c = e.catalogo!;
    // Los product_id son FRESCOS (creados en este mismo escenario): la
    // membresía es inmune a cualquier dato previo de esta base compartida.
    // producto[0]: qty 1 (orden 1) + qty 1 (orden 3) = 2. producto[1]: qty 2 (orden 2) + qty 2 (orden 3) = 4.
    const fila0 = e.topProducts!.body.data.find((f) => f.product_id === c.productos[0]!.id);
    const fila1 = e.topProducts!.body.data.find((f) => f.product_id === c.productos[1]!.id);
    assert.ok(fila0, 'producto[0] no aparece en el ranking');
    assert.ok(fila1, 'producto[1] no aparece en el ranking');
    assert.equal(fila0!.quantity_sold, 2, 'cantidad vendida de producto[0] incorrecta');
    assert.equal(fila1!.quantity_sold, 4, 'cantidad vendida de producto[1] incorrecta');
  },
);

Then(
  'el resumen muestra la cantidad de órdenes, el monto facturado y el desglose por estado',
  function (this: CatalogWorld) {
    const e = est(this);
    assert.equal(e.summary!.status, 200);
    assert.equal(
      e.summary!.body.orders_count - e.summaryDefault!.body.orders_count,
      e.ordenes!.length,
      'el DELTA de orders_count no suma las 3 órdenes sembradas',
    );
    const totalEsperado = e.ordenes!.reduce((acc, o) => acc + o.totalArsCents, 0);
    assert.equal(
      e.summary!.body.total_ars_cents - e.summaryDefault!.body.total_ars_cents,
      totalEsperado,
      'el DELTA de total_ars_cents no coincide con la suma de las 3 órdenes',
    );
    assert.equal(
      e.summary!.body.breakdown_by_status.new!.count - e.summaryDefault!.body.breakdown_by_status.new!.count,
      e.ordenes!.length,
    );
  },
);

Then(
  'los tres coinciden entre sí en la cantidad total de órdenes del período',
  function (this: CatalogWorld) {
    const e = est(this);
    const hoy = new Date().toISOString().slice(0, 10);
    const deltaSales = filaDelDia(e.sales!.body, hoy) - filaDelDia(e.salesDefault!.body, hoy);
    const deltaSummary = e.summary!.body.orders_count - e.summaryDefault!.body.orders_count;
    assert.equal(deltaSales, deltaSummary, 'sales y summary no coinciden en el DELTA de orders_count');
  },
);

// ─── H-2 ────────────────────────────────────────────────────────────────────

Given('una orden real confirmada por pago hace 40 días', PASO, async function (this: CatalogWorld) {
  const e = est(this);
  // Única excepción de este escenario: backdatearCreatedAt (qa-plan.md §6) —
  // ningún endpoint fija `created_at`, y AC-4 exige probar el filtro de rango
  // contra una fecha real que exceda la ventana por defecto (30 días).
  e.orden = await crearOrdenActiva('new', { adminToken: this.token });
  const hace40 = new Date();
  hace40.setDate(hace40.getDate() - 40);
  await backdatearCreatedAt(e.orden.id, hace40);
  e.orden = { ...e.orden };
  (e as unknown as { fecha40: Date }).fecha40 = hace40;
});

Given('ninguna orden real en los últimos 7 días', function () {
  // Paso documental: nada que sembrar — el punto del escenario es que la
  // orden de 40 días NO aparece en el rango por defecto, no que la base esté
  // vacía (otros escenarios de esta misma corrida pueden haber sembrado
  // órdenes "de hoy", y eso es exactamente lo que este escenario no necesita
  // controlar: el filtro estructural por `created_at >= range.from` es lo
  // que se está probando).
});

When(
  'el dueño consulta las métricas con el rango por defecto \\(30 días\\)',
  PASO,
  async function (this: CatalogWorld) {
    const e = est(this);
    e.salesDefault = await metricaJson<SalesResponse>(this, 'sales');
    e.topProductsDefault = await metricaJson<TopProductsResponse>(this, 'top-products');
    e.summaryDefault = await metricaJson<SummaryResponse>(this, 'summary');
  },
);

Then('esa orden no aparece en ninguna de las tres', function (this: CatalogWorld) {
  const e = est(this);
  const fecha40 = (e as unknown as { fecha40: Date }).fecha40;
  const diaBackdate = fecha40.toISOString().slice(0, 10);
  assert.ok(
    !e.salesDefault!.body.data.some((r) => r.period_date === diaBackdate),
    'la evolución de ventas por defecto incluye el día de la orden de 40 días',
  );
  assert.ok(
    !e.topProductsDefault!.body.data.some((f) => f.product_id === e.orden!.items[0]!.productId),
    'el ranking por defecto incluye el producto de la orden de 40 días',
  );
  // El resumen no expone membresía por orden: se prueba estructuralmente —
  // el `range.from` que el propio backend devuelve es más nuevo que la fecha
  // backdateada, así que esa orden queda estructuralmente afuera del filtro
  // `created_at >= range.from` que agrega orders_count/total_ars_cents.
  const rangeFrom = new Date(e.summaryDefault!.body.range.from).getTime();
  assert.ok(
    fecha40.getTime() < rangeFrom,
    'range.from del resumen por defecto no es posterior a la orden de 40 días',
  );
});

When(
  'el dueño consulta las métricas con un rango que sí cubre esos 40 días',
  PASO,
  async function (this: CatalogWorld) {
    const e = est(this);
    const desde = new Date();
    desde.setDate(desde.getDate() - 45);
    const qs = rangoQs(desde.toISOString(), new Date().toISOString());
    e.salesWide = await metricaJson<SalesResponse>(this, 'sales', qs);
    // `limit=50` (el máximo del DTO): un rango de 45 días real puede incluir
    // el long-tail de productos de otros escenarios de esta misma corrida —
    // sin el límite ampliado, el default (10) podría dejar el producto de
    // ESTA orden fuera del ranking por mérito de otros productos, no por un
    // defecto del filtro de rango que este escenario prueba.
    e.topProductsWide = await metricaJson<TopProductsResponse>(this, 'top-products', `${qs}&limit=50`);
    e.summaryWide = await metricaJson<SummaryResponse>(this, 'summary', qs);
  },
);

Then('esa orden aparece en las tres', function (this: CatalogWorld) {
  const e = est(this);
  const fecha40 = (e as unknown as { fecha40: Date }).fecha40;
  const diaBackdate = fecha40.toISOString().slice(0, 10);
  const filaSales = e.salesWide!.body.data.find((r) => r.period_date === diaBackdate);
  assert.ok(filaSales, 'la evolución de ventas ampliada no incluye el día de la orden de 40 días');
  assert.ok(
    filaSales!.orders_count >= 1,
    'la fila del día de la orden de 40 días no tiene al menos 1 orden',
  );
  assert.ok(
    e.topProductsWide!.body.data.some((f) => f.product_id === e.orden!.items[0]!.productId),
    'el ranking ampliado no incluye el producto de la orden de 40 días',
  );
  assert.ok(
    e.summaryWide!.body.orders_count >= 1,
    'el resumen ampliado no cuenta ninguna orden',
  );
});

// ─── H-3 ────────────────────────────────────────────────────────────────────

Given('una orden real confirmada por pago dentro del período consultado', PASO, async function (
  this: CatalogWorld,
) {
  const e = est(this);
  e.desde = new Date().toISOString();
  e.orden = await crearOrdenActiva('new', { adminToken: this.token });
  e.hasta = new Date().toISOString();
});

When(
  'el dueño pide el JSON y el CSV de cada una de las tres métricas para el mismo rango',
  PASO,
  async function (this: CatalogWorld) {
    const e = est(this);
    const qs = rangoQs(e.desde, e.hasta);
    e.sales = await metricaJson<SalesResponse>(this, 'sales', qs);
    e.topProducts = await metricaJson<TopProductsResponse>(this, 'top-products', qs);
    e.summary = await metricaJson<SummaryResponse>(this, 'summary', qs);
    e.csvSales = await metricaCsv(this, 'sales', qs);
    e.csvTopProducts = await metricaCsv(this, 'top-products', qs);
    e.csvSummary = await metricaCsv(this, 'summary', qs);
  },
);

Then(
  'el CSV de ventas, el de productos y el de resumen contienen los mismos valores que sus respuestas JSON hermanas',
  function (this: CatalogWorld) {
    const e = est(this);
    const filasSalesCsv = e.csvSales!.text.trim().split('\n').slice(1);
    assert.equal(filasSalesCsv.length, e.sales!.body.data.length, 'sales: distinta cantidad de filas CSV vs JSON');
    for (const [i, fila] of e.sales!.body.data.entries()) {
      const [periodo, count, total] = filasSalesCsv[i]!.split(',');
      assert.equal(periodo, fila.period_date);
      assert.equal(Number(count), fila.orders_count);
      assert.equal(Number(total), fila.total_ars_cents);
    }

    const filasTopCsv = e.csvTopProducts!.text.trim().split('\n').slice(1);
    assert.equal(filasTopCsv.length, e.topProducts!.body.data.length, 'top-products: distinta cantidad de filas CSV vs JSON');
    for (const [i, fila] of e.topProducts!.body.data.entries()) {
      const cols = filasTopCsv[i]!.split(',');
      assert.equal(cols[0], fila.product_id);
      assert.equal(Number(cols[3]), fila.quantity_sold);
      assert.equal(Number(cols[4]), fila.revenue_ars_cents);
    }

    const filasSummaryCsv = e.csvSummary!.text.trim().split('\n');
    // header + 4 estados + total
    assert.equal(filasSummaryCsv.length, 6, 'summary: el CSV no tiene header + 4 estados + total');
    const filaTotal = filasSummaryCsv[filasSummaryCsv.length - 1]!.split(',');
    assert.equal(filaTotal[0], 'total');
    assert.equal(Number(filaTotal[1]), e.summary!.body.orders_count);
    assert.equal(Number(filaTotal[2]), e.summary!.body.total_ars_cents);
  },
);

Then(
  'los tres archivos tienen el Content-Type text\\/csv y un Content-Disposition de tipo attachment',
  function (this: CatalogWorld) {
    const e = est(this);
    for (const csv of [e.csvSales!, e.csvTopProducts!, e.csvSummary!]) {
      assert.equal(csv.status, 200);
      assert.ok(
        (csv.headers['content-type'] ?? '').startsWith('text/csv'),
        `Content-Type inesperado: ${csv.headers['content-type']}`,
      );
      assert.ok(
        (csv.headers['content-disposition'] ?? '').startsWith('attachment'),
        `Content-Disposition inesperado: ${csv.headers['content-disposition']}`,
      );
    }
  },
);

// ─── C-1 / C-3 (rango futuro compartido) ───────────────────────────────────

const RANGO_FUTURO = rangoQs('2031-01-01T00:00:00.000Z', '2031-01-31T23:59:59.000Z');

Given('un rango de fechas futuro, sin ninguna orden', function () {
  // Nada que sembrar: el rango es 2031, estructuralmente sin datos.
});

When('el dueño consulta las tres métricas para ese rango', PASO, async function (
  this: CatalogWorld,
) {
  const e = est(this);
  e.sales = await metricaJson<SalesResponse>(this, 'sales', RANGO_FUTURO);
  e.topProducts = await metricaJson<TopProductsResponse>(this, 'top-products', RANGO_FUTURO);
  e.summary = await metricaJson<SummaryResponse>(this, 'summary', RANGO_FUTURO);
});

Then('la evolución de ventas es un array vacío', function (this: CatalogWorld) {
  const e = est(this);
  assert.equal(e.sales!.status, 200);
  assert.deepEqual(e.sales!.body.data, []);
});

Then('el ranking de productos es un array vacío', function (this: CatalogWorld) {
  const e = est(this);
  assert.equal(e.topProducts!.status, 200);
  assert.deepEqual(e.topProducts!.body.data, []);
});

Then('el resumen tiene orders_count y total_ars_cents en cero', function (this: CatalogWorld) {
  const e = est(this);
  assert.equal(e.summary!.status, 200);
  assert.equal(e.summary!.body.orders_count, 0);
  assert.equal(e.summary!.body.total_ars_cents, 0);
});

Then('el desglose por estado tiene las 4 claves activas, cada una en cero', function (
  this: CatalogWorld,
) {
  const e = est(this);
  const breakdown = e.summary!.body.breakdown_by_status;
  for (const status of SALE_STATUSES) {
    assert.ok(status in breakdown, `falta la clave "${status}" en breakdown_by_status`);
    assert.equal(breakdown[status]!.count, 0);
    assert.equal(breakdown[status]!.total_ars_cents, 0);
  }
});

Then('ninguna de las tres respuestas es un error', function (this: CatalogWorld) {
  const e = est(this);
  assert.equal(e.sales!.status, 200);
  assert.equal(e.topProducts!.status, 200);
  assert.equal(e.summary!.status, 200);
});

// ─── C-2 ────────────────────────────────────────────────────────────────────

Given('la política de retención vigente de 12 meses', function () {
  // Documental: `ORDER_RETENTION_MONTHS` no está override-ado por la suite QA
  // (`qa/scripts/api-up.sh` no lo toca) — el default del backend es 12.
});

Given('una orden real confirmada por pago dentro de la ventana de retención', PASO, async function (
  this: CatalogWorld,
) {
  const e = est(this);
  e.orden = await crearOrdenActiva('new', { adminToken: this.token });
});

When('el dueño pide un rango que empieza 24 meses atrás', PASO, async function (
  this: CatalogWorld,
) {
  const e = est(this);
  const hace24meses = new Date();
  hace24meses.setMonth(hace24meses.getMonth() - 24);
  const qs = rangoQs(hace24meses.toISOString(), new Date().toISOString());
  e.sales = await metricaJson<SalesResponse>(this, 'sales', qs);
  // `limit=50`: mismo motivo que H-2 — un rango de 24 meses puede incluir el
  // long-tail de otros escenarios de esta corrida.
  e.topProducts = await metricaJson<TopProductsResponse>(this, 'top-products', `${qs}&limit=50`);
  e.summary = await metricaJson<SummaryResponse>(this, 'summary', qs);
});

Then('la respuesta es 200, nunca 422', function (this: CatalogWorld) {
  const e = est(this);
  assert.equal(e.sales!.status, 200);
  assert.equal(e.topProducts!.status, 200);
  assert.equal(e.summary!.status, 200);
});

Then('el rango efectivo devuelto \\(range.from\\) es el piso de retención, no lo pedido', function (
  this: CatalogWorld,
) {
  const e = est(this);
  const pedido24m = new Date();
  pedido24m.setMonth(pedido24m.getMonth() - 24);
  const piso12m = new Date();
  piso12m.setMonth(piso12m.getMonth() - 12);
  const rangeFrom = new Date(e.summary!.body.range.from);
  // El from efectivo debe estar CERCA del piso de 12 meses (± 1 día de margen
  // por el reloj real de la corrida) y CLARAMENTE lejos del pedido de 24 meses.
  const diffPiso = Math.abs(rangeFrom.getTime() - piso12m.getTime());
  assert.ok(diffPiso < 2 * 24 * 60 * 60 * 1000, `range.from (${rangeFrom.toISOString()}) no está cerca del piso de retención`);
  assert.ok(
    rangeFrom.getTime() > pedido24m.getTime() + 300 * 24 * 60 * 60 * 1000,
    'range.from quedó igual al pedido de 24 meses — no se acotó',
  );
});

Then('la orden dentro de la ventana aparece en los tres datasets', function (this: CatalogWorld) {
  const e = est(this);
  assert.ok(
    e.topProducts!.body.data.some((f) => f.product_id === e.orden!.items[0]!.productId),
    'la orden reciente no aparece en el ranking',
  );
  assert.ok(e.summary!.body.orders_count >= 1, 'la orden reciente no aparece en el resumen');
  const diaOrden = new Date().toISOString().slice(0, 10);
  assert.ok(
    e.sales!.body.data.some((r) => r.period_date === diaOrden),
    'la orden reciente no aparece en la evolución de ventas',
  );
});

// ─── C-3 ────────────────────────────────────────────────────────────────────

When('el dueño descarga el CSV de cada una de las tres métricas para ese rango', PASO, async function (
  this: CatalogWorld,
) {
  const e = est(this);
  e.csvSales = await metricaCsv(this, 'sales', RANGO_FUTURO);
  e.csvTopProducts = await metricaCsv(this, 'top-products', RANGO_FUTURO);
  e.csvSummary = await metricaCsv(this, 'summary', RANGO_FUTURO);
});

Then('los tres archivos son CSV válidos con al menos la fila de encabezado', function (
  this: CatalogWorld,
) {
  const e = est(this);
  assert.equal(e.csvSales!.status, 200);
  assert.equal(e.csvTopProducts!.status, 200);
  assert.equal(e.csvSummary!.status, 200);
  assert.ok(e.csvSales!.text.startsWith('period_date,orders_count,total_ars_cents'));
  assert.ok(e.csvTopProducts!.text.startsWith('product_id,product_name,product_sku,quantity_sold,revenue_ars_cents'));
  assert.ok(e.csvSummary!.text.startsWith('status,count,total_ars_cents'));
});

Then('ninguno de los tres es un archivo vacío ni una respuesta de error', function (
  this: CatalogWorld,
) {
  const e = est(this);
  assert.ok(e.csvSales!.text.trim().length > 0);
  assert.ok(e.csvTopProducts!.text.trim().length > 0);
  // El resumen SIEMPRE trae 4 filas de estado + total, aun en período vacío (zero-fill, AC-5).
  assert.equal(e.csvSummary!.text.trim().split('\n').length, 6);
});

// ─── N-1 ────────────────────────────────────────────────────────────────────

Given('un visitante sin ninguna sesión', function () {
  // Nada que sembrar: `this.anon` (World) ya es un contexto sin Authorization.
});

When('intenta consultar cualquiera de los 6 endpoints de reportes', PASO, async function (
  this: CatalogWorld,
) {
  const e = est(this);
  e.respuestasDenegadas = [];
  for (const path of REPORTS_ENDPOINTS) {
    const res = await this.anon.get(`/v1/admin/reports/${path}`);
    e.respuestasDenegadas.push({ path, status: res.status() });
  }
});

// Texto distinto del homónimo de `ordenes.steps.ts` (mismo verbo, dato
// distinto: acá `respuestasDenegadas` es un array de 6 endpoints, no un
// listado + un patch) — evita la ambigüedad de Cucumber entre step files.
Then('el sistema deniega la solicitud de métricas', function (this: CatalogWorld) {
  const e = est(this);
  for (const r of e.respuestasDenegadas!) {
    assert.ok([401, 403].includes(r.status), `${r.path}: status ${r.status}, se esperaba 401/403`);
  }
});

When(
  'una cuenta de cliente real \\(US-014, sesión válida pero no admin\\) lo intenta',
  PASO,
  async function (this: CatalogWorld) {
    const e = est(this);
    const sesion = await nuevaCuenta('-us016-n1');
    const estado = await sesion.ctx.storageState();
    const accessToken = estado.cookies.find((c) => c.name === 'dsm_access')?.value;
    assert.ok(accessToken, 'la cuenta de cliente no emitió dsm_access');
    e.respuestasClienteDenegadas = [];
    for (const path of REPORTS_ENDPOINTS) {
      const res = await fetch(`${process.env.QA_API_BASE_URL ?? 'http://localhost:3000'}/v1/admin/reports/${path}`, {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      e.respuestasClienteDenegadas.push({ path, status: res.status });
    }
    await sesion.ctx.dispose();
  },
);

Then('el sistema la deniega igual que al visitante sin sesión', function (this: CatalogWorld) {
  const e = est(this);
  for (const r of e.respuestasClienteDenegadas!) {
    assert.ok([401, 403].includes(r.status), `${r.path}: status ${r.status}, se esperaba 401/403`);
  }
});

// ─── N-2 ────────────────────────────────────────────────────────────────────

// Texto distinto del homónimo de `ordenes.steps.ts` (mismo dominio, seed
// distinto: `seed-metricas.ts` guarda `items[].productId`, que
// `seed-ordenes.ts` no expone) — evita la ambigüedad de Cucumber.
Given(
  'una orden real recién generada por checkout, todavía sin confirmar el pago \\(métricas\\)',
  PASO,
  async function (this: CatalogWorld) {
    const e = est(this);
    e.desde = new Date().toISOString();
    e.orden = await crearOrdenPendiente({ adminToken: this.token });
    e.hasta = new Date().toISOString();
  },
);

When('el dueño consulta las tres métricas para el período que la incluiría', PASO, async function (
  this: CatalogWorld,
) {
  const e = est(this);
  const qs = rangoQs(e.desde, e.hasta);
  e.sales = await metricaJson<SalesResponse>(this, 'sales', qs);
  e.topProducts = await metricaJson<TopProductsResponse>(this, 'top-products', qs);
  e.summary = await metricaJson<SummaryResponse>(this, 'summary', qs);
});

Then('esa orden no está contada en orders_count', function (this: CatalogWorld) {
  assert.equal(est(this).summary!.body.orders_count, 0);
});

Then('no aporta a total_ars_cents', function (this: CatalogWorld) {
  assert.equal(est(this).summary!.body.total_ars_cents, 0);
});

Then('sus productos no aparecen en el ranking', function (this: CatalogWorld) {
  const e = est(this);
  assert.ok(
    !e.topProducts!.body.data.some((f) => f.product_id === e.orden!.items[0]!.productId),
    'el producto de la orden pending_payment aparece en el ranking',
  );
});

// ─── N-3 ────────────────────────────────────────────────────────────────────

Given(
  'una orden real cuyo pago automático se aprobó pero el stock ya no alcanzaba al confirmar',
  PASO,
  async function (this: CatalogWorld) {
    const e = est(this);
    e.desde = new Date().toISOString();
    e.orden = await crearOrdenCanceladaPorStock({ adminToken: this.token });
  },
);

Given('esa orden quedó "cancelled" con el pago en estado de reembolso', PASO, async function (
  this: CatalogWorld,
) {
  const e = est(this);
  // Verificación de la precondición vía la API real (no Prisma): el detalle
  // admin de la orden confirma el estado que `crearOrdenCanceladaPorStock`
  // dejó (`confirm-order.service.ts` — rama `simulated_dsm` marca `refunded`
  // sincrónicamente).
  const detalle = await apiCall<{ status: string }>(
    `/v1/admin/orders/${e.orden!.id}`,
    'GET',
    this.token,
  );
  assert.equal(detalle.status, 'cancelled');
  e.hasta = new Date().toISOString();
});

Then('no aparece en el desglose por estado', function (this: CatalogWorld) {
  const e = est(this);
  const total = Object.values(e.summary!.body.breakdown_by_status).reduce(
    (acc, v) => acc + v.count,
    0,
  );
  assert.equal(total, 0, 'la orden cancelada por stock aparece en alguna de las 4 claves activas');
});

// ─── X-1 ────────────────────────────────────────────────────────────────────

Given(
  'seis órdenes nacidas de un checkout real, cada una llevada por su camino real hasta A pending_payment, B new, C preparing, D ready, E delivered y F cancelled por falta de stock',
  PASO,
  async function (this: CatalogWorld) {
    const e = est(this);
    // 3 productos: [0]/[1] compartidos por A-E, [2] EXCLUSIVO de F (que baja
    // su stock a 0 — reusar un producto compartido dejaría sin stock a
    // cualquier otra orden de este mismo lote, ver seed-metricas.smoke.ts).
    const catalogo = await catalogoParaMetricas(3, { token: this.token });
    const p0 = catalogo.productos[0]!;
    const p1 = catalogo.productos[1]!;
    const p2 = catalogo.productos[2]!;

    e.desde = new Date().toISOString();

    const itemP0 = (qty: number) => [{ slug: p0.slug, quantity: qty, priceArsCents: p0.price_ars_cents, productName: p0.name, productId: p0.id }];
    const itemP1 = (qty: number) => [{ slug: p1.slug, quantity: qty, priceArsCents: p1.price_ars_cents, productName: p1.name, productId: p1.id }];
    const itemP2 = (qty: number) => [{ slug: p2.slug, quantity: qty, priceArsCents: p2.price_ars_cents, productName: p2.name, productId: p2.id }];

    const a = await crearOrdenPendiente({ adminToken: this.token, catalogo, items: itemP0(1) });
    const b = await crearOrdenActiva('new', { adminToken: this.token, catalogo, items: itemP0(1) });
    const c = await crearOrdenActiva('preparing', { adminToken: this.token, catalogo, items: itemP1(2) });
    const d = await crearOrdenActiva('ready', { adminToken: this.token, catalogo, items: itemP0(1) });
    const eOrden = await crearOrdenActiva('delivered', { adminToken: this.token, catalogo, items: itemP1(1) });
    const f = await crearOrdenCanceladaPorStock({ adminToken: this.token, catalogo, items: itemP2(1) });

    e.ordenes = [a, b, c, d, eOrden, f];
    (e as unknown as { catalogoX1: typeof catalogo }).catalogoX1 = catalogo;
    e.hasta = new Date().toISOString();
  },
);

When('el dueño consulta el resumen del período que las incluye a las seis', PASO, async function (
  this: CatalogWorld,
) {
  const e = est(this);
  e.summary = await metricaJson<SummaryResponse>(this, 'summary', rangoQs(e.desde, e.hasta));
});

Then('orders_count es 4, no 6', function (this: CatalogWorld) {
  assert.equal(est(this).summary!.body.orders_count, 4);
});

Then(
  'el desglose por estado tiene exactamente una orden en cada uno de new, preparing, ready, delivered',
  function (this: CatalogWorld) {
    const breakdown = est(this).summary!.body.breakdown_by_status;
    for (const status of SALE_STATUSES) {
      assert.equal(breakdown[status]!.count, 1, `breakdown_by_status.${status}.count debía ser 1`);
    }
  },
);

Then('total_ars_cents es la suma exacta de los montos de B, C, D y E — nunca A ni F', function (
  this: CatalogWorld,
) {
  const e = est(this);
  const [, b, c, d, eOrden] = e.ordenes!;
  const esperado = b!.totalArsCents + c!.totalArsCents + d!.totalArsCents + eOrden!.totalArsCents;
  assert.equal(e.summary!.body.total_ars_cents, esperado);
});

When('el dueño consulta la evolución de ventas para ese mismo período', PASO, async function (
  this: CatalogWorld,
) {
  const e = est(this);
  e.sales = await metricaJson<SalesResponse>(this, 'sales', rangoQs(e.desde, e.hasta));
});

Then('la suma de orders_count de todas las filas es 4', function (this: CatalogWorld) {
  const total = est(this).sales!.body.data.reduce((acc, r) => acc + r.orders_count, 0);
  assert.equal(total, 4);
});

When('el dueño consulta el ranking de productos para ese mismo período', PASO, async function (
  this: CatalogWorld,
) {
  const e = est(this);
  e.topProducts = await metricaJson<TopProductsResponse>(this, 'top-products', rangoQs(e.desde, e.hasta));
});

Then('la cantidad vendida de cada producto sólo cuenta las líneas de B, C, D y E', function (
  this: CatalogWorld,
) {
  const e = est(this);
  const catalogo = (e as unknown as { catalogoX1: { productos: ProductoParaMetricas[] } }).catalogoX1;
  const p0 = catalogo.productos[0]!;
  const p1 = catalogo.productos[1]!;
  const p2 = catalogo.productos[2]!;

  const fila0 = e.topProducts!.body.data.find((f) => f.product_id === p0.id);
  const fila1 = e.topProducts!.body.data.find((f) => f.product_id === p1.id);
  const fila2 = e.topProducts!.body.data.find((f) => f.product_id === p2.id);

  // p0: B(1) + D(1) = 2 (A también usa p0, pero está pending_payment: excluida).
  assert.ok(fila0, 'producto[0] (B+D) no aparece en el ranking');
  assert.equal(fila0!.quantity_sold, 2);
  // p1: C(2) + E(1) = 3.
  assert.ok(fila1, 'producto[1] (C+E) no aparece en el ranking');
  assert.equal(fila1!.quantity_sold, 3);
  // p2: sólo F (cancelled) lo usa — no debe aparecer en absoluto.
  assert.equal(fila2, undefined, 'producto[2] (sólo usado por F, cancelled) aparece en el ranking');
});

// ─── X-2 ────────────────────────────────────────────────────────────────────

Given(
  'un producto renombrado en el catálogo después de que un cliente lo compró vía checkout real',
  PASO,
  async function (this: CatalogWorld) {
    const e = est(this);
    const catalogo = await catalogoParaMetricas(1, { token: this.token });
    const producto = catalogo.productos[0]!;
    e.nombreOriginal = producto.name;
    e.desde = new Date().toISOString();
    e.orden = await crearOrdenActiva('new', { adminToken: this.token, catalogo, items: [
      { slug: producto.slug, quantity: 1, priceArsCents: producto.price_ars_cents, productName: producto.name, productId: producto.id },
    ] });
    e.hasta = new Date().toISOString();
    await apiCall(`/v1/admin/products/${producto.id}`, 'PATCH', this.token, {
      name: `${producto.name} RENOMBRADO`,
    });
    e.productoRenombrado = producto;
  },
);

When('el dueño consulta el ranking de productos del período de esa compra', PASO, async function (
  this: CatalogWorld,
) {
  const e = est(this);
  e.topProducts = await metricaJson<TopProductsResponse>(this, 'top-products', rangoQs(e.desde, e.hasta));
});

Then('el ranking muestra el nombre tal como estaba al momento de la compra', function (
  this: CatalogWorld,
) {
  const e = est(this);
  const fila = e.topProducts!.body.data.find((f) => f.product_id === e.productoRenombrado!.id);
  assert.ok(fila, 'el producto renombrado no aparece en el ranking');
  assert.equal(fila!.product_name, e.nombreOriginal, 'el ranking no muestra el nombre SNAPSHOT');
});

Then('no el nombre actual del producto en el catálogo', function (this: CatalogWorld) {
  const e = est(this);
  const fila = e.topProducts!.body.data.find((f) => f.product_id === e.productoRenombrado!.id);
  assert.notEqual(fila!.product_name, `${e.nombreOriginal} RENOMBRADO`);
});
