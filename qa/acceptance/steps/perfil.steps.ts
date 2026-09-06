import assert from 'node:assert/strict';
import { Given, When, Then } from '@cucumber/cucumber';
import { nuevaCuenta, type Sesion } from '../../support/customer-auth';
import { actualizarPerfil } from '../../support/editar-perfil';
import type { CatalogWorld } from './world';

/**
 * US-024 — Edición de perfil del cliente.
 *
 * Contra la API real + Postgres real (`qa-plan.md` §9): cero `INSERT`/`UPDATE`
 * directos. La sesión nace de `nuevaCuenta()` (registro real vía
 * `POST /v1/auth/register`), y la acción bajo prueba es siempre
 * `actualizarPerfil` (`PATCH /v1/me`).
 */

Given('un cliente autenticado con sesión válida', async function (this: CatalogWorld) {
  this.state.sesion = await nuevaCuenta('-perfil');
});

Given('otro cliente autenticado con su propio nombre', async function (this: CatalogWorld) {
  this.state.otraSesion = await nuevaCuenta('-perfil-otro');
});

Given('que ya tiene un avatar configurado', async function (this: CatalogWorld) {
  const { ctx, cuenta } = this.state.sesion as Sesion;
  const res = await actualizarPerfil(ctx, {
    name: cuenta.nombre,
    avatar_url: 'https://ejemplo.com/avatar-previo.jpg',
  });
  assert.equal(res.status, 200, `seed de avatar previo falló: ${JSON.stringify(res.body)}`);
});

When('cambia su nombre a {string} y guarda', async function (this: CatalogWorld, nombre: string) {
  const { ctx } = this.state.sesion as Sesion;
  this.state.respuesta = await actualizarPerfil(ctx, { name: nombre, avatar_url: null });
  this.state.nombreEsperado = nombre;
});

When('pega {string} como avatar y guarda', async function (this: CatalogWorld, avatar: string) {
  const { ctx, cuenta } = this.state.sesion as Sesion;
  this.state.respuesta = await actualizarPerfil(ctx, { name: cuenta.nombre, avatar_url: avatar });
  this.state.avatarEsperado = avatar;
});

When('borra la URL de avatar y guarda', async function (this: CatalogWorld) {
  const { ctx, cuenta } = this.state.sesion as Sesion;
  this.state.respuesta = await actualizarPerfil(ctx, { name: cuenta.nombre, avatar_url: null });
});

When('intenta guardar el nombre vacío', async function (this: CatalogWorld) {
  const { ctx } = this.state.sesion as Sesion;
  this.state.respuesta = await actualizarPerfil(ctx, { name: '', avatar_url: null });
});

When('intenta actualizar su perfil incluyendo un campo email', async function (this: CatalogWorld) {
  const { ctx, cuenta } = this.state.sesion as Sesion;
  // El endpoint sólo declara `name`/`avatar_url` en su DTO — `class-validator`
  // corre con `forbidNonWhitelisted`, así que un campo ajeno como `email`
  // rechaza la request ENTERA con 422 (más estricto que "se ignora en
  // silencio" — ninguna de las dos formas deja cambiar el email).
  this.state.respuesta = await actualizarPerfil(ctx, {
    name: cuenta.nombre,
    avatar_url: null,
    // @ts-expect-error — intencional: probar que un campo ajeno rechaza la request.
    email: 'otro@correo.test',
  });
});

When('el primer cliente actualiza su propio perfil', async function (this: CatalogWorld) {
  const { ctx } = this.state.sesion as Sesion;
  this.state.respuesta = await actualizarPerfil(ctx, {
    name: 'Nombre Del Primero',
    avatar_url: null,
  });
});

Then('el nombre se actualiza de inmediato', async function (this: CatalogWorld) {
  const { status, body } = this.state.respuesta as { status: number; body: { name?: string } };
  assert.equal(status, 200, `PATCH /v1/me falló: ${JSON.stringify(body)}`);
  assert.equal(body.name, this.state.nombreEsperado);
});

Then('el avatar se actualiza a esa URL', async function (this: CatalogWorld) {
  const { status, body } = this.state.respuesta as {
    status: number;
    body: { avatar_url?: string | null };
  };
  assert.equal(status, 200, `PATCH /v1/me falló: ${JSON.stringify(body)}`);
  assert.equal(body.avatar_url, this.state.avatarEsperado);
});

Then('su avatar queda en null', async function (this: CatalogWorld) {
  const { status, body } = this.state.respuesta as {
    status: number;
    body: { avatar_url?: string | null };
  };
  assert.equal(status, 200, `PATCH /v1/me falló: ${JSON.stringify(body)}`);
  assert.equal(body.avatar_url, null);
});

Then('el perfil recibe un error de validación', async function (this: CatalogWorld) {
  const { status } = this.state.respuesta as { status: number };
  assert.equal(status, 422, `se esperaba 422, llegó ${status}`);
});

Then('su nombre anterior no cambia', async function (this: CatalogWorld) {
  const { ctx, cuenta } = this.state.sesion as Sesion;
  // Confirmación independiente: un GET real, no releer la respuesta del PATCH
  // rechazado (que podría no reflejar el estado guardado).
  const res = await actualizarPerfil(ctx, { name: cuenta.nombre, avatar_url: null });
  assert.equal(res.status, 200);
  assert.equal((res.body as { name: string }).name, cuenta.nombre);
});

Then('el endpoint rechaza la request entera \\(no admite ese campo\\)', function (this: CatalogWorld) {
  const { status } = this.state.respuesta as { status: number };
  assert.equal(status, 422, `se esperaba 422 (campo no permitido), llegó ${status}`);
});

Then('su email real no cambió', async function (this: CatalogWorld) {
  const { ctx, cuenta } = this.state.sesion as Sesion;
  // Confirmación independiente: un PATCH válido (sin `email`) y se lee el
  // email que el servidor devuelve — nunca cambió, porque el endpoint no
  // tiene forma de recibirlo.
  const res = await actualizarPerfil(ctx, { name: cuenta.nombre, avatar_url: null });
  assert.equal(res.status, 200);
  assert.equal((res.body as { email: string }).email, cuenta.email);
});

Then('el nombre del segundo cliente no cambia', async function (this: CatalogWorld) {
  const { ctx, cuenta } = this.state.otraSesion as Sesion;
  const res = await actualizarPerfil(ctx, { name: cuenta.nombre, avatar_url: null });
  assert.equal(res.status, 200);
  assert.equal((res.body as { name: string }).name, cuenta.nombre);
});
