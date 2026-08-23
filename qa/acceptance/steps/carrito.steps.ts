import assert from 'node:assert/strict';
import { Given, When, Then } from '@cucumber/cucumber';
import { apiCall } from '../../support/api';
import {
  esComprable,
  nuevoInvitado,
  reabrir,
  type Cart,
  type Invitado,
} from '../../support/cart-client';
import { seedCarrito, type SeedCarrito } from '../../support/seed-carrito';
import type { CatalogWorld } from './world';

/** Los pasos tocan red (siembra + varias escrituras); 5 s del default es corto. */
const PASO = { timeout: 60_000 };

interface Estado {
  seed: SeedCarrito;
  invitado: Invitado;
  carrito: Cart;
  /** Última respuesta de escritura, para asertar rechazos. */
  ultima?: { status: number; body: unknown };
  /** Slugs con los que el escenario armó su carrito, en orden. */
  usados: string[];
}

function est(w: CatalogWorld): Estado {
  return w.state as unknown as Estado;
}

async function refrescar(w: CatalogWorld): Promise<Cart> {
  const { body } = await est(w).invitado.ver();
  est(w).carrito = body;
  return body;
}

function linea(carrito: Cart, slug: string) {
  const l = carrito.items.find((i) => i.slug === slug);
  assert.ok(l, `el carrito no tiene la línea de ${slug}`);
  return l;
}

Given('un catálogo sembrado con productos para el carrito', PASO, async function (
  this: CatalogWorld,
) {
  const e = est(this);
  e.seed = await seedCarrito();
  e.invitado = await nuevoInvitado();
  e.usados = [];
});

When(
  'un invitado agrega {int} unidades de un producto publicado a su carrito',
  PASO,
  async function (this: CatalogWorld, cantidad: number) {
    const e = est(this);
    const slug = e.seed.mixtoA.slug;
    e.ultima = await e.invitado.fijar(slug, cantidad);
    e.usados.push(slug);
    await refrescar(this);
  },
);

Given(
  'un invitado con {int} unidad de un producto en su carrito',
  PASO,
  async function (this: CatalogWorld, cantidad: number) {
    const e = est(this);
    const slug = e.seed.mixtoA.slug;
    await e.invitado.fijar(slug, cantidad);
    e.usados.push(slug);
    await refrescar(this);
  },
);

Given('un invitado con dos productos distintos en su carrito', PASO, async function (
  this: CatalogWorld,
) {
  const e = est(this);
  for (const p of [e.seed.mixtoA, e.seed.paraDespublicar]) {
    await e.invitado.fijar(p.slug, 1);
    e.usados.push(p.slug);
  }
  await refrescar(this);
});

Given(
  'un invitado con {int} unidades del producto de stock limitado en su carrito',
  PASO,
  async function (this: CatalogWorld, cantidad: number) {
    const e = est(this);
    const slug = e.seed.stockTres.slug;
    await e.invitado.fijar(slug, cantidad);
    e.usados.push(slug);
    await refrescar(this);
  },
);

Given('un invitado que nunca agregó nada', PASO, async function (this: CatalogWorld) {
  // Invitado fresco: el del Antecedentes ya existe, pero no escribió nada.
  est(this).invitado = await nuevoInvitado();
});

When('cambia la cantidad de ese producto a {int}', PASO, async function (
  this: CatalogWorld,
  cantidad: number,
) {
  const e = est(this);
  e.ultima = await e.invitado.fijar(e.usados[0], cantidad);
  await refrescar(this);
});

When('intenta subir la cantidad a {int}', PASO, async function (
  this: CatalogWorld,
  cantidad: number,
) {
  const e = est(this);
  e.ultima = await e.invitado.fijar(e.usados[0], cantidad);
});

When('quita uno de los dos', PASO, async function (this: CatalogWorld) {
  const e = est(this);
  e.ultima = await e.invitado.quitar(e.usados[0]);
  await refrescar(this);
});

When(
  'cierra el navegador y vuelve conservando sólo sus cookies persistentes',
  PASO,
  async function (this: CatalogWorld) {
    const e = est(this);
    e.invitado = await reabrir(e.invitado);
    await refrescar(this);
  },
);

When('abre su carrito', PASO, async function (this: CatalogWorld) {
  await refrescar(this);
});

When('lo vuelve a abrir', PASO, async function (this: CatalogWorld) {
  await refrescar(this);
});

When('el dueño despublica uno de los dos', PASO, async function (this: CatalogWorld) {
  const e = est(this);
  await apiCall(
    `/v1/admin/products/${e.seed.paraDespublicar.id}`,
    'PATCH',
    e.seed.token,
    { status: 'archived' },
  );
});

When('el invitado abre su carrito', PASO, async function (this: CatalogWorld) {
  await refrescar(this);
});

Then('el carrito muestra ese producto con {int} unidades', function (
  this: CatalogWorld,
  cantidad: number,
) {
  const e = est(this);
  assert.equal(linea(e.carrito, e.usados[0]).quantity, cantidad);
});

Then('muestra el precio unitario que el dueño le puso', function (this: CatalogWorld) {
  const e = est(this);
  assert.equal(
    linea(e.carrito, e.usados[0]).unit_price_ars_cents,
    e.seed.mixtoA.price_ars_cents,
  );
});

Then('el subtotal de la línea es el precio por la cantidad', function (
  this: CatalogWorld,
) {
  const e = est(this);
  const l = linea(e.carrito, e.usados[0]);
  assert.equal(l.subtotal_ars_cents, l.unit_price_ars_cents * l.quantity);
});

Then('el total del carrito refleja esa línea', function (this: CatalogWorld) {
  const e = est(this);
  assert.equal(e.carrito.total_ars_cents, linea(e.carrito, e.usados[0]).subtotal_ars_cents);
});

Then('el subtotal de la línea acompaña la cantidad nueva', function (
  this: CatalogWorld,
) {
  const e = est(this);
  const l = linea(e.carrito, e.usados[0]);
  assert.equal(l.subtotal_ars_cents, l.unit_price_ars_cents * l.quantity);
});

Then('el total del carrito se recalcula', function (this: CatalogWorld) {
  const e = est(this);
  const suma = e.carrito.items.reduce((acc, i) => acc + i.subtotal_ars_cents, 0);
  assert.equal(e.carrito.total_ars_cents, suma);
});

Then('ese producto ya no está en el carrito', function (this: CatalogWorld) {
  const e = est(this);
  assert.ok(
    !e.carrito.items.some((i) => i.slug === e.usados[0]),
    'la línea quitada sigue en el carrito',
  );
});

Then('el total del carrito es el del producto que queda', function (this: CatalogWorld) {
  const e = est(this);
  assert.equal(e.carrito.items.length, 1);
  assert.equal(e.carrito.total_ars_cents, e.carrito.items[0].subtotal_ars_cents);
});

Then('recupera el mismo carrito con los dos productos', function (this: CatalogWorld) {
  const e = est(this);
  assert.ok(e.carrito.id, 'tras reabrir no hay carrito');
  assert.equal(e.carrito.items.length, 2);
  for (const slug of e.usados) linea(e.carrito, slug);
});

Then('no tuvo que crear ninguna cuenta', function (this: CatalogWorld) {
  // La identidad viaja sólo en la cookie del carrito: el cliente nunca manda
  // Authorization ni pasa por /v1/auth. Si alguien cambiara eso, este assert
  // no alcanzaría — por eso el cliente tampoco expone forma de hacerlo.
  assert.ok(est(this).carrito.id, 'el carrito se recuperó sin cuenta');
});

Then('el sistema rechaza la operación', function (this: CatalogWorld) {
  const e = est(this);
  assert.ok(
    e.ultima && e.ultima.status >= 400,
    `se esperaba un rechazo, llegó ${e.ultima?.status}`,
  );
});

Then('le informa cuántas unidades hay realmente disponibles', function (
  this: CatalogWorld,
) {
  const cuerpo = est(this).ultima?.body as { available_quantity?: number } | undefined;
  assert.equal(
    cuerpo?.available_quantity,
    3,
    'el rechazo no informa el stock realmente disponible',
  );
});

Then('su carrito sigue teniendo las {int} unidades de antes', PASO, async function (
  this: CatalogWorld,
  cantidad: number,
) {
  const carrito = await refrescar(this);
  assert.equal(linea(carrito, est(this).usados[0]).quantity, cantidad);
});

Then('ve un carrito vacío, sin error', function (this: CatalogWorld) {
  const c = est(this).carrito;
  assert.equal(c.items.length, 0);
  assert.equal(c.total_ars_cents, 0);
});

Then('sigue viendo un carrito vacío', function (this: CatalogWorld) {
  assert.equal(est(this).carrito.items.length, 0);
});

Then('el sistema no le abrió ningún carrito por haberlo mirado', function (
  this: CatalogWorld,
) {
  // `id: null` es la prueba de que leer es una operación segura: si mirar
  // creara el carrito, acá habría un identificador.
  assert.equal(est(this).carrito.id, null);
});

Then('ve las dos líneas, cada una con su propio subtotal', function (
  this: CatalogWorld,
) {
  const e = est(this);
  assert.equal(e.carrito.items.length, 2);
  for (const l of e.carrito.items) {
    assert.equal(l.subtotal_ars_cents, l.unit_price_ars_cents * l.quantity);
  }
});

Then(
  'el total del carrito es solamente el de la línea que sí puede comprar',
  function (this: CatalogWorld) {
    const e = est(this);
    const comprables = e.carrito.items.filter(esComprable);
    assert.equal(comprables.length, 1, 'se esperaba exactamente una línea comprable');
    assert.equal(e.carrito.total_ars_cents, comprables[0].subtotal_ars_cents);
  },
);

Then('el carrito avisa que hay algo que impide avanzar al pago', function (
  this: CatalogWorld,
) {
  // Es la señal que el checkout de US-008 consume para bloquear el avance.
  assert.equal(est(this).carrito.has_blocking_issues, true);
});
