import assert from 'node:assert/strict';
import { Given, When, Then } from '@cucumber/cucumber';
import { nuevaCuenta, type Sesion } from '../../support/customer-auth';
import { catalogoParaCheckout } from '../../support/seed-ordenes';
import { compraEntregada } from '../../support/seed-resenas';
import { dejarReseña, miReseña, reseñasPúblicas, moderarReseña } from '../../support/resenas';
import type { CatalogWorld } from './world';

/**
 * US-025 — Reseñas y calificaciones de productos.
 *
 * Contra la API real + Postgres real (`qa-plan.md` §9): cero `INSERT`/
 * `UPDATE` directos sobre `reviews`. La elegibilidad se siembra con una
 * compra logueada real que llega a `delivered`
 * (`compraEntregada`, `seed-resenas.ts`) — nunca un flag ni un `UPDATE`
 * directo de `orders.status`.
 */

async function productoPublicado(): Promise<{ token: string; productId: string; slug: string }> {
  const { token, productos } = await catalogoParaCheckout(1);
  const p = productos[0]!;
  return { token, productId: p.id, slug: p.slug };
}

Given(
  'un cliente con una orden delivered de un producto publicado',
  async function (this: CatalogWorld) {
    const { token, productId, slug } = await productoPublicado();
    const sesion = await nuevaCuenta('-resenas');
    await compraEntregada(sesion, slug, token);
    this.state.sesion = sesion;
    this.state.productId = productId;
    this.state.adminToken = token;
  },
);

Given(
  'un producto con reseñas de {int}, {int} y {int} estrellas de clientes distintos',
  async function (this: CatalogWorld, r1: number, r2: number, r3: number) {
    const { token, productId, slug } = await productoPublicado();
    for (const [i, rating] of [r1, r2, r3].entries()) {
      const sesion = await nuevaCuenta(`-resenas-h3-${i}`);
      await compraEntregada(sesion, slug, token);
      const res = await dejarReseña(sesion.ctx, productId, { rating });
      assert.equal(res.status, 200, `seed de reseña falló: ${JSON.stringify(res.body)}`);
    }
    this.state.slug = slug;
  },
);

Given('un producto publicado sin ninguna reseña', async function (this: CatalogWorld) {
  const { slug } = await productoPublicado();
  this.state.slug = slug;
});

Given(
  'un cliente que ya dejó una reseña de {int} estrellas de un producto',
  async function (this: CatalogWorld, rating: number) {
    const { token, productId, slug } = await productoPublicado();
    const sesion = await nuevaCuenta('-resenas-h5');
    await compraEntregada(sesion, slug, token);
    const res = await dejarReseña(sesion.ctx, productId, { rating });
    assert.equal(res.status, 200, `seed de reseña previa falló: ${JSON.stringify(res.body)}`);
    this.state.sesion = sesion;
    this.state.productId = productId;
    this.state.slug = slug;
  },
);

Given('una reseña visible de un producto', async function (this: CatalogWorld) {
  const { token, productId, slug } = await productoPublicado();
  const sesion = await nuevaCuenta('-resenas-h6');
  await compraEntregada(sesion, slug, token);
  const res = await dejarReseña(sesion.ctx, productId, { rating: 2, comment: 'Ofensivo (seed)' });
  assert.equal(res.status, 200);
  this.state.sesion = sesion;
  this.state.productId = productId;
  this.state.slug = slug;
  this.state.reviewId = (res.body as { id: string }).id;
  this.state.adminToken = token;
});

Given(
  'un cliente autenticado que nunca compró un producto publicado',
  async function (this: CatalogWorld) {
    const { productId } = await productoPublicado();
    this.state.sesion = await nuevaCuenta('-resenas-n1');
    this.state.productId = productId;
  },
);

Given('una persona sin sesión iniciada', async function (this: CatalogWorld) {
  const { productId } = await productoPublicado();
  this.state.productId = productId;
});

When(
  'deja una reseña de {int} estrellas con comentario {string}',
  async function (this: CatalogWorld, rating: number, comment: string) {
    const { ctx } = this.state.sesion as Sesion;
    this.state.respuesta = await dejarReseña(ctx, this.state.productId as string, {
      rating,
      comment,
    });
  },
);

When(
  'deja una reseña de {int} estrellas sin comentario',
  async function (this: CatalogWorld, rating: number) {
    const { ctx } = this.state.sesion as Sesion;
    this.state.respuesta = await dejarReseña(ctx, this.state.productId as string, { rating });
  },
);

When('cualquier persona consulta las reseñas públicas de ese producto', async function (this: CatalogWorld) {
  this.state.respuesta = await reseñasPúblicas(this.state.slug as string);
});

When('cualquier persona consulta sus reseñas públicas', async function (this: CatalogWorld) {
  this.state.respuesta = await reseñasPúblicas(this.state.slug as string);
});

When('cambia su calificación a {int} estrellas del mismo producto', async function (this: CatalogWorld, rating: number) {
  const { ctx } = this.state.sesion as Sesion;
  this.state.respuesta = await dejarReseña(ctx, this.state.productId as string, { rating });
});

When('el dueño la oculta desde el endpoint de moderación', async function (this: CatalogWorld) {
  this.state.respuesta = await moderarReseña(
    this.state.adminToken as string,
    this.state.reviewId as string,
    true,
  );
});

When('intenta dejar una reseña de ese producto', async function (this: CatalogWorld) {
  const { ctx } = this.state.sesion as Sesion;
  this.state.respuesta = await dejarReseña(ctx, this.state.productId as string, { rating: 5 });
});

When('intenta dejar una reseña de un producto publicado', async function (this: CatalogWorld) {
  this.state.respuesta = await dejarReseña(
    (this as CatalogWorld).anon,
    this.state.productId as string,
    { rating: 5 },
  );
});

When('intenta dejar una reseña con {int} estrellas', async function (this: CatalogWorld, rating: number) {
  const { ctx } = this.state.sesion as Sesion;
  this.state.respuesta = await dejarReseña(ctx, this.state.productId as string, { rating });
});

Then(
  'la reseña se guarda con esa calificación y comentario',
  function (this: CatalogWorld) {
    const { status, body } = this.state.respuesta as {
      status: number;
      body: { rating: number; comment: string | null };
    };
    assert.equal(status, 200, `PUT /v1/me/reviews falló: ${JSON.stringify(body)}`);
    assert.equal(body.rating, 4);
    assert.equal(body.comment, 'Anduvo bien');
  },
);

Then('la reseña se guarda igual, sin comentario', function (this: CatalogWorld) {
  const { status, body } = this.state.respuesta as {
    status: number;
    body: { rating: number; comment: string | null };
  };
  assert.equal(status, 200, `PUT /v1/me/reviews falló: ${JSON.stringify(body)}`);
  assert.equal(body.rating, 5);
  assert.equal(body.comment, null);
});

Then('ve el promedio {string} y {string} reseñas', function (this: CatalogWorld, avg: string, count: string) {
  const { status, body } = this.state.respuesta as {
    status: number;
    body: { average: number; count: number };
  };
  assert.equal(status, 200);
  assert.equal(body.average, Number(avg));
  assert.equal(body.count, Number(count));
});

Then('el promedio es null y el conteo es 0', function (this: CatalogWorld) {
  const { status, body } = this.state.respuesta as {
    status: number;
    body: { average: number | null; count: number };
  };
  assert.equal(status, 200);
  assert.equal(body.average, null);
  assert.equal(body.count, 0);
});

Then('se actualiza la MISMA reseña, sin aumentar el conteo total', async function (this: CatalogWorld) {
  const { status, body } = this.state.respuesta as {
    status: number;
    body: { rating: number };
  };
  assert.equal(status, 200, `PUT /v1/me/reviews falló: ${JSON.stringify(body)}`);
  assert.equal(body.rating, 5);
  const pub = await reseñasPúblicas(this.state.slug as string);
  assert.equal((pub.body as { count: number }).count, 1, 'debía seguir habiendo 1 sola reseña, no 2');
});

Then('deja de contarse en el promedio público', async function (this: CatalogWorld) {
  const pub = await reseñasPúblicas(this.state.slug as string);
  assert.equal((pub.body as { count: number }).count, 0, 'la reseña oculta no debía contar');
});

Then('el cliente autor, al consultar su propia reseña, la ve marcada como oculta', async function (this: CatalogWorld) {
  const { ctx } = this.state.sesion as Sesion;
  const propia = await miReseña(ctx, this.state.productId as string);
  const body = propia.body as { review: { hidden: boolean } };
  assert.equal(body.review.hidden, true, 'el autor debía ver su reseña marcada oculta, no borrada en silencio');
});

Then('el sistema lo rechaza con 403', function (this: CatalogWorld) {
  const { status } = this.state.respuesta as { status: number };
  assert.equal(status, 403, `se esperaba 403, llegó ${status}`);
});

Then('el sistema lo rechaza sin crear ninguna reseña', function (this: CatalogWorld) {
  const { status } = this.state.respuesta as { status: number };
  assert.notEqual(status, 200, `un invitado no debía poder dejar una reseña (llegó ${status})`);
});

Then('no se guarda ninguna reseña', async function (this: CatalogWorld) {
  const { status } = this.state.respuesta as { status: number };
  assert.notEqual(status, 200);
});

Then('recibe un error de validación', function (this: CatalogWorld) {
  const { status } = this.state.respuesta as { status: number };
  assert.equal(status, 422, `se esperaba 422, llegó ${status}`);
});
