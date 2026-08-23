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

// ─────────────────────────────────────────────────────────────────────────────
// Fase 3 — negative-space y cross-feature
// ─────────────────────────────────────────────────────────────────────────────

/** Respuestas de los tres estados no publicables, para compararlas entre sí. */
interface EstadoNegativo extends Estado {
  rechazos: Record<string, { status: number; body: unknown }>;
  invitados: Invitado[];
  precioOriginal: number;
}

function neg(w: CatalogWorld): EstadoNegativo {
  const e = est(w) as EstadoNegativo;
  e.rechazos ??= {};
  return e;
}

When(
  'un invitado intenta agregar a su carrito un producto en estado {string}',
  PASO,
  async function (this: CatalogWorld, estado: string) {
    const e = neg(this);
    const slug =
      estado === 'borrador'
        ? e.seed.draft.slug
        : estado === 'archivado'
          ? e.seed.archivado.slug
          : 'producto-que-no-existe-jamas';

    e.ultima = await e.invitado.fijar(slug, 1);
    e.rechazos[estado] = e.ultima;
    e.usados = [slug];
  },
);

Then('el producto no queda incorporado al carrito', PASO, async function (
  this: CatalogWorld,
) {
  const carrito = await refrescar(this);
  assert.ok(
    !carrito.items.some((i) => i.slug === est(this).usados[0]),
    'el producto rechazado quedó en el carrito',
  );
});

Then(
  'la respuesta es indistinguible de la de un producto que no existe',
  PASO,
  async function (this: CatalogWorld) {
    const e = neg(this);
    // Se compara contra un inexistente pedido en el momento, no contra otro
    // ejemplo: cada corrida del Esquema es un escenario independiente y no
    // comparte estado con los demás.
    const control = await e.invitado.fijar('producto-control-inexistente', 1);
    const actual = e.ultima!;

    assert.equal(
      actual.status,
      control.status,
      `el estado responde ${actual.status} y un inexistente ${control.status}: distinguibles`,
    );
    const tipo = (r: unknown) => (r as { type?: string } | undefined)?.type;
    assert.equal(
      tipo(actual.body),
      tipo(control.body),
      'el tipo de error delata si el producto existe pero está oculto',
    );
  },
);

Given('un producto publicado con exactamente {int} unidades de stock', PASO, function (
  this: CatalogWorld,
  stock: number,
) {
  // Lo siembra el Antecedentes; acá se verifica que el fixture es el que el
  // escenario necesita — con stock alto, tres invitados entrarían igual y el
  // escenario no distinguiría una reserva.
  assert.equal(stock, 3, 'la invariante de AC-8 está diseñada para stock 3');
});

When(
  'tres invitados distintos ponen las {int} unidades cada uno en su carrito',
  PASO,
  async function (this: CatalogWorld, unidades: number) {
    const e = neg(this);
    e.invitados = [e.invitado, await nuevoInvitado(), await nuevoInvitado()];

    for (const inv of e.invitados) {
      const r = await inv.fijar(e.seed.stockTres.slug, unidades);
      assert.equal(
        r.status,
        200,
        `un invitado fue rechazado con ${r.status}: hay reserva de stock`,
      );
    }
  },
);

Then('los tres carritos tienen las {int} unidades disponibles para comprar', PASO,
  async function (this: CatalogWorld, unidades: number) {
    const e = neg(this);
    for (const [i, inv] of e.invitados.entries()) {
      const { body } = await inv.ver();
      const l = linea(body, e.seed.stockTres.slug);
      assert.equal(l.quantity, unidades, `el invitado ${i + 1} no tiene ${unidades}`);
      // Con reserva, este sería `insufficient_stock` para el segundo y el tercero.
      assert.equal(
        l.availability,
        'available',
        `el invitado ${i + 1} ve ${l.availability}: hay reserva de stock`,
      );
    }
  },
);

Then('el dueño sigue viendo {int} unidades de stock en su panel', PASO, async function (
  this: CatalogWorld,
  stock: number,
) {
  const e = neg(this);
  // Contra la superficie del DUEÑO, no contra el repositorio del carrito: es lo
  // que se rompería si US-008 o US-010 introdujeran la reserva.
  const dto = await apiCall<{ stock: number }>(
    `/v1/admin/products/${e.seed.stockTres.id}`,
    'GET',
    e.seed.token,
  );
  assert.equal(dto.stock, stock, `el panel muestra ${dto.stock} en vez de ${stock}`);
});

Then('la ficha pública sigue anunciando el producto como disponible', PASO,
  async function (this: CatalogWorld) {
    const e = neg(this);
    const ficha = await e.invitado.ctx.get(`/v1/products/${e.seed.stockTres.slug}`);
    assert.equal(ficha.status(), 200, 'la ficha pública dejó de estar accesible');
    const dto = (await ficha.json()) as { in_stock: boolean };
    assert.equal(dto.in_stock, true, 'la ficha dejó de anunciar el producto disponible');
  },
);

When('los tres modifican y quitan líneas de sus carritos', PASO, async function (
  this: CatalogWorld,
) {
  const e = neg(this);
  const slug = e.seed.stockTres.slug;
  // Ciclo completo: bajar, subir y quitar. Descarta un decremento diferido que
  // se aplicara en alguna de esas transiciones.
  for (const inv of e.invitados) {
    await inv.fijar(slug, 1);
    await inv.fijar(slug, 3);
    await inv.quitar(slug);
  }
});

Given('un invitado con un producto publicado en su carrito', PASO, async function (
  this: CatalogWorld,
) {
  const e = est(this);
  await e.invitado.fijar(e.seed.paraDespublicar.slug, 2);
  e.usados = [e.seed.paraDespublicar.slug];
  await refrescar(this);
});

When('el dueño despublica ese producto desde el panel', PASO, async function (
  this: CatalogWorld,
) {
  const e = est(this);
  await apiCall(
    `/v1/admin/products/${e.seed.paraDespublicar.id}`,
    'PATCH',
    e.seed.token,
    { status: 'archived' },
  );
});

When('el invitado vuelve a abrir su carrito', PASO, async function (this: CatalogWorld) {
  await refrescar(this);
});

Then('la línea sigue estando, marcada como no disponible', function (
  this: CatalogWorld,
) {
  const e = est(this);
  const l = linea(e.carrito, e.usados[0]);
  assert.notEqual(l.availability, 'available', 'la línea sigue comprable');
});

Then('queda fuera del total del carrito', function (this: CatalogWorld) {
  const e = est(this);
  const comprables = e.carrito.items.filter(esComprable);
  const suma = comprables.reduce((acc, i) => acc + i.subtotal_ars_cents, 0);
  assert.equal(e.carrito.total_ars_cents, suma);
});

When('el invitado quita esa línea', PASO, async function (this: CatalogWorld) {
  const e = est(this);
  e.ultima = await e.invitado.quitar(e.usados[0]);
  await refrescar(this);
});

Then('la línea desaparece sin error', function (this: CatalogWorld) {
  const e = est(this);
  // Un ítem que no se puede comprar y tampoco sacar deja al cliente encerrado.
  assert.equal(e.ultima?.status, 200, `quitar la línea bloqueada dio ${e.ultima?.status}`);
  assert.ok(!e.carrito.items.some((i) => i.slug === e.usados[0]));
});

Given('un invitado con un producto de precio conocido en su carrito', PASO,
  async function (this: CatalogWorld) {
    const e = neg(this);
    await e.invitado.fijar(e.seed.paraCambiarPrecio.slug, 2);
    e.usados = [e.seed.paraCambiarPrecio.slug];
    e.precioOriginal = e.seed.paraCambiarPrecio.price_ars_cents;
    await refrescar(this);
  },
);

When('el dueño le cambia el precio desde el panel', PASO, async function (
  this: CatalogWorld,
) {
  const e = neg(this);
  await apiCall(
    `/v1/admin/products/${e.seed.paraCambiarPrecio.id}`,
    'PATCH',
    e.seed.token,
    { price_ars_cents: e.precioOriginal * 2 },
  );
});

Then('el importe unitario, el subtotal y el total usan el precio nuevo', function (
  this: CatalogWorld,
) {
  const e = neg(this);
  const nuevo = e.precioOriginal * 2;
  const l = linea(e.carrito, e.usados[0]);

  assert.equal(l.unit_price_ars_cents, nuevo, 'el unitario quedó en el precio viejo');
  assert.equal(l.subtotal_ars_cents, nuevo * l.quantity);
  assert.equal(e.carrito.total_ars_cents, nuevo * l.quantity);
});

Then('el carrito avisa que ese precio cambió desde que lo agregó', function (
  this: CatalogWorld,
) {
  assert.equal(linea(est(this).carrito, est(this).usados[0]).price_changed, true);
});

Then('la respuesta del carrito no es cacheable', PASO, async function (
  this: CatalogWorld,
) {
  const { headers } = await est(this).invitado.ver();
  const cc = headers['cache-control'] ?? '';
  // La ficha puede servir el precio viejo desde su caché de 60 s; el carrito no.
  assert.match(cc, /no-store/, `Cache-Control del carrito: "${cc}"`);
});

Given(
  'un producto publicado que el invitado encontró en su ficha pública',
  PASO,
  async function (this: CatalogWorld) {
    const e = neg(this);
    const res = await e.invitado.ctx.get(`/v1/products/${e.seed.mixtoB.slug}`);
    assert.equal(res.status(), 200, 'la ficha pública no sirve el producto');
    const ficha = (await res.json()) as { slug: string; price_ars_cents: number };
    e.state = { ...(e.state ?? {}) };
    e.precioOriginal = ficha.price_ars_cents;
    e.usados = [ficha.slug];
  },
);

When('lo agrega al carrito usando el identificador que la ficha publica', PASO,
  async function (this: CatalogWorld) {
    const e = neg(this);
    // El mismo `slug` que la ficha publicó, sin traducción: es la red contra la
    // divergencia de identificador público (la lección de D-1 en US-002).
    e.ultima = await e.invitado.fijar(e.usados[0], 1);
    await refrescar(this);
  },
);

Then('el producto entra al carrito', function (this: CatalogWorld) {
  const e = est(this);
  assert.equal(e.ultima?.status, 200, `el carrito rechazó el slug de la ficha`);
  linea(e.carrito, e.usados[0]);
});

Then('el precio que el carrito cobra es el que la ficha mostraba', function (
  this: CatalogWorld,
) {
  const e = neg(this);
  assert.equal(
    linea(e.carrito, e.usados[0]).unit_price_ars_cents,
    e.precioOriginal,
    'la ficha y el carrito muestran precios distintos',
  );
});

