import assert from 'node:assert/strict';
import { Given, When, Then } from '@cucumber/cucumber';
import { catalogoParaCheckout, crearOrdenEnEstado, productoParaCheckout } from '../../support/seed-ordenes';
import { apiCall } from '../../support/api';
import { novedades, masVendidos, type RespuestaDestacados } from '../../support/destacados';
import type { CatalogWorld } from './world';

/**
 * US-026 — Novedades y más vendidos del home.
 *
 * Contra la API real + Postgres real (`qa-plan.md` §9): cero `INSERT`/
 * `UPDATE` directos. El orden de los escenarios en el `.feature` es
 * narrativo a propósito (ver el comentario del `.feature`) — los que
 * necesitan un conteo EXACTO del catálogo van primero.
 *
 * `this.state` (el `World` de Cucumber) se resetea en CADA escenario — la
 * continuidad narrativa entre SC-026-N2 y SC-026-E1 (mismo catálogo, sigue
 * sumando) necesita un acumulador de **módulo**, no de World, porque lo que
 * persiste entre escenarios es el Postgres real, no el World.
 */
const productosAcumulados: string[] = [];

Given('que no hay ningún producto en estado "published" todavía', function () {
  // Nada que sembrar — el Postgres de esta corrida arranca vacío y este es
  // el primer escenario del archivo.
});

Given(
  'un producto publicado sin ninguna venta confirmada',
  async function (this: CatalogWorld) {
    const { productos } = await catalogoParaCheckout(1);
    this.state.productoSlug = productos[0]!.slug;
    productosAcumulados.push(productos[0]!.slug);
  },
);

Given(
  'que el catálogo llega a exactamente 3 productos publicados en total',
  async function (this: CatalogWorld) {
    // El escenario anterior (SC-026-N2) ya dejó 1 producto (acumulado a
    // nivel de módulo, no de World — ver comentario de arriba) — se
    // agregan 2 más para llegar a 3 en total, continuación narrativa
    // deliberada.
    const { productos } = await catalogoParaCheckout(2);
    productosAcumulados.push(productos[0]!.slug, productos[1]!.slug);
    this.state.tresSlugs = [...productosAcumulados];
  },
);

Given(
  '3 productos publicados en orden de alta: A \\(más viejo\\), B, C \\(más nuevo\\)',
  async function (this: CatalogWorld) {
    const { productos } = await catalogoParaCheckout(3);
    this.state.slugA = productos[0]!.slug;
    this.state.slugB = productos[1]!.slug;
    this.state.slugC = productos[2]!.slug;
  },
);

Given('un producto publicado sin stock recién creado', async function (this: CatalogWorld) {
  const { token, categoryId } = await catalogoParaCheckout(0);
  const creado = await productoParaCheckout(token, categoryId, { stock: 0 });
  this.state.productoSinStockSlug = creado.slug;
});

Given(
  'el producto X vendido {int} unidades y el producto Y vendido {int} unidades en una orden confirmada',
  async function (this: CatalogWorld, qtyX: number, qtyY: number) {
    const { token, productos } = await catalogoParaCheckout(2);
    const [x, y] = productos as [
      (typeof productos)[number],
      (typeof productos)[number],
    ];
    await crearOrdenEnEstado('new', {
      adminToken: token,
      items: [
        { slug: x.slug, quantity: qtyX, priceArsCents: x.price_ars_cents, productName: x.name },
        { slug: y.slug, quantity: qtyY, priceArsCents: y.price_ars_cents, productName: y.name },
      ],
    });
    this.state.slugX = x.slug;
    this.state.slugY = y.slug;
  },
);

Given(
  'un producto que fue "published", tuvo una venta confirmada, y luego pasó a "archived"',
  async function (this: CatalogWorld) {
    const { token, productos } = await catalogoParaCheckout(1);
    const p = productos[0]!;
    await crearOrdenEnEstado('new', {
      adminToken: token,
      items: [{ slug: p.slug, quantity: 3, priceArsCents: p.price_ars_cents, productName: p.name }],
    });
    await apiCall(`/v1/admin/products/${p.id}`, 'PATCH', token, { status: 'archived' });
    this.state.slugArchivado = p.slug;
  },
);

Given(
  'dos productos con exactamente la misma cantidad vendida en una orden confirmada',
  async function (this: CatalogWorld) {
    const { token, productos } = await catalogoParaCheckout(2);
    const [p, q] = productos as [
      (typeof productos)[number],
      (typeof productos)[number],
    ];
    await crearOrdenEnEstado('new', {
      adminToken: token,
      items: [
        { slug: p.slug, quantity: 4, priceArsCents: p.price_ars_cents, productName: p.name },
        { slug: q.slug, quantity: 4, priceArsCents: q.price_ars_cents, productName: q.name },
      ],
    });
    this.state.slugEmpateP = p.slug;
    this.state.slugEmpateQ = q.slug;
  },
);

When('consulto novedades y más vendidos', async function (this: CatalogWorld) {
  this.state.respuestaNovedades = await novedades();
  this.state.respuestaMasVendidos = await masVendidos();
});

When('consulto novedades', async function (this: CatalogWorld) {
  this.state.respuestaNovedades = await novedades();
});

When('aparece en novedades', async function (this: CatalogWorld) {
  this.state.respuestaNovedades = await novedades();
});

When('consulto más vendidos', async function (this: CatalogWorld) {
  this.state.respuestaMasVendidos = await masVendidos();
});

When('consulto más vendidos dos veces seguidas', async function (this: CatalogWorld) {
  this.state.respuestaMasVendidos1 = await masVendidos();
  this.state.respuestaMasVendidos2 = await masVendidos();
});

Then('ambas responden una lista vacía, sin error', function (this: CatalogWorld) {
  const n = this.state.respuestaNovedades as RespuestaDestacados;
  const m = this.state.respuestaMasVendidos as RespuestaDestacados;
  assert.equal(n.status, 200);
  assert.equal(m.status, 200);
  assert.deepEqual(n.body?.data, []);
  assert.deepEqual(m.body?.data, []);
});

Then('novedades lo incluye', function (this: CatalogWorld) {
  const n = this.state.respuestaNovedades as RespuestaDestacados;
  assert.equal(n.status, 200);
  assert.ok(n.body?.data.some((p) => p.slug === this.state.productoSlug));
});

Then('más vendidos sigue vacío', function (this: CatalogWorld) {
  const m = this.state.respuestaMasVendidos as RespuestaDestacados;
  assert.equal(m.status, 200);
  assert.deepEqual(m.body?.data, []);
});

Then('recibo exactamente esos 3, sin relleno ni error', function (this: CatalogWorld) {
  const n = this.state.respuestaNovedades as RespuestaDestacados;
  const esperados = (this.state.tresSlugs as string[]).slice().sort();
  const recibidos = (n.body?.data ?? []).map((p) => p.slug).sort();
  assert.equal(n.status, 200);
  assert.deepEqual(recibidos, esperados);
});

Then('C aparece antes que B, y B antes que A', function (this: CatalogWorld) {
  const n = this.state.respuestaNovedades as RespuestaDestacados;
  const slugs = (n.body?.data ?? []).map((p) => p.slug);
  const posC = slugs.indexOf(this.state.slugC as string);
  const posB = slugs.indexOf(this.state.slugB as string);
  const posA = slugs.indexOf(this.state.slugA as string);
  assert.ok(posC !== -1 && posB !== -1 && posA !== -1, 'los 3 deben estar presentes');
  assert.ok(posC < posB, 'C (más nuevo) debe ir antes que B');
  assert.ok(posB < posA, 'B debe ir antes que A (más viejo)');
});

Then('se lo ve marcado sin stock, no oculto', function (this: CatalogWorld) {
  const n = this.state.respuestaNovedades as RespuestaDestacados;
  const item = n.body?.data.find((p) => p.slug === this.state.productoSinStockSlug);
  assert.ok(item, 'el producto sin stock debe seguir apareciendo, no oculto');
  assert.equal(item!.in_stock, false);
});

Then('X aparece antes que Y', function (this: CatalogWorld) {
  const m = this.state.respuestaMasVendidos as RespuestaDestacados;
  const slugs = (m.body?.data ?? []).map((p) => p.slug);
  const posX = slugs.indexOf(this.state.slugX as string);
  const posY = slugs.indexOf(this.state.slugY as string);
  assert.ok(posX !== -1 && posY !== -1, 'ambos deben estar presentes');
  assert.ok(posX < posY, 'X (más vendido) debe ir antes que Y');
});

Then('ese producto NO aparece', function (this: CatalogWorld) {
  const m = this.state.respuestaMasVendidos as RespuestaDestacados;
  const slugs = (m.body?.data ?? []).map((p) => p.slug);
  assert.ok(!slugs.includes(this.state.slugArchivado as string));
});

Then(
  'ningún item de ninguna de las dos respuestas tiene los campos "id", "status" ni "revenue_ars_cents"',
  function (this: CatalogWorld) {
    const n = this.state.respuestaNovedades as RespuestaDestacados;
    const m = this.state.respuestaMasVendidos as RespuestaDestacados;
    for (const item of [...(n.body?.data ?? []), ...(m.body?.data ?? [])]) {
      const claves = Object.keys(item as unknown as Record<string, unknown>);
      assert.ok(!claves.includes('id'), `no debe exponer id: ${JSON.stringify(item)}`);
      assert.ok(!claves.includes('status'), `no debe exponer status: ${JSON.stringify(item)}`);
      assert.ok(
        !claves.includes('revenue_ars_cents'),
        `no debe exponer revenue_ars_cents: ${JSON.stringify(item)}`,
      );
    }
  },
);

Then(
  'ambas respuestas traen el header Cache-Control {string}',
  function (this: CatalogWorld, esperado: string) {
    const n = this.state.respuestaNovedades as RespuestaDestacados;
    const m = this.state.respuestaMasVendidos as RespuestaDestacados;
    assert.equal(n.headers['cache-control'], esperado);
    assert.equal(m.headers['cache-control'], esperado);
  },
);

Then('el orden entre ellos es idéntico en ambas respuestas', function (this: CatalogWorld) {
  const m1 = this.state.respuestaMasVendidos1 as RespuestaDestacados;
  const m2 = this.state.respuestaMasVendidos2 as RespuestaDestacados;
  const posEnRespuesta = (r: RespuestaDestacados) => {
    const slugs = r.body?.data.map((p) => p.slug) ?? [];
    return [slugs.indexOf(this.state.slugEmpateP as string), slugs.indexOf(this.state.slugEmpateQ as string)];
  };
  const [p1, q1] = posEnRespuesta(m1);
  const [p2, q2] = posEnRespuesta(m2);
  assert.ok(p1! !== -1 && q1! !== -1, 'ambos deben estar presentes en la primera respuesta');
  assert.equal(p1! < q1!, p2! < q2!, 'el orden relativo entre P y Q debe ser idéntico en las 2 corridas');
});
