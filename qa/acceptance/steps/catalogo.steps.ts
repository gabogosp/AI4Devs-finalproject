import assert from 'node:assert/strict';
import { Given, When, Then } from '@cucumber/cucumber';
import { nuevaCategoria, nuevoProducto } from '../../support/builders';
import { adminAuthWithSource } from '../../support/admin-auth';
import type { CatalogWorld } from './world';

interface Category { id: string; slug: string; name: string }
interface Product { id: string; sku: string; status: string; category_id: string }

Given('una sesión admin válida', function (this: CatalogWorld) {
  assert.ok(this.token, 'no hay token admin');
});

When('creo una categoría', async function (this: CatalogWorld) {
  const res = await this.admin.post('/v1/admin/categories', { data: nuevaCategoria() });
  assert.equal(res.status(), 201, `alta categoría → ${res.status()}`);
  this.state.category = (await res.json()) as Category;
});

Then('la categoría tiene un slug único derivado', function (this: CatalogWorld) {
  const c = this.state.category as Category;
  assert.match(c.slug, /^[a-z0-9-]+$/, `slug inválido: ${c.slug}`);
});

When('creo un producto en esa categoría', async function (this: CatalogWorld) {
  const c = this.state.category as Category;
  const res = await this.admin.post('/v1/admin/products', { data: nuevoProducto(c.id) });
  assert.equal(res.status(), 201, `alta producto → ${res.status()}`);
  this.state.product = (await res.json()) as Product;
});

Then('el producto queda en estado {string}', async function (this: CatalogWorld, expected: string) {
  const p = this.state.product as Product;
  const res = await this.admin.get(`/v1/admin/products/${p.id}`);
  assert.equal(res.status(), 200);
  const fresh = (await res.json()) as Product;
  assert.equal(fresh.status, expected, `estado ${fresh.status} != ${expected}`);
  this.state.product = fresh;
});

When('publico el producto', async function (this: CatalogWorld) {
  const p = this.state.product as Product;
  this.state.lastRes = await this.admin.patch(`/v1/admin/products/${p.id}`, { data: { status: 'published' } });
});

When('archivo el producto', async function (this: CatalogWorld) {
  const p = this.state.product as Product;
  this.state.lastRes = await this.admin.patch(`/v1/admin/products/${p.id}`, { data: { status: 'archived' } });
});

// --- Negative / corner ---

When('intento crear un producto con {word} inválido', async function (this: CatalogWorld, campo: string) {
  const c = this.state.category as Category;
  const bad = nuevoProducto(c.id) as Record<string, unknown>;
  if (campo === 'precio') bad.price_ars_cents = 0;
  else if (campo === 'stock') bad.stock = -1;
  else if (campo === 'nombre') bad.name = '';
  else if (campo === 'categoria') bad.category_id = '00000000-0000-0000-0000-0000000000ff';
  this.state.lastRes = await this.admin.post('/v1/admin/products', { data: bad });
});

When('creo un producto con un SKU nuevo', async function (this: CatalogWorld) {
  const c = this.state.category as Category;
  const sku = `DUP-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  this.state.dupSku = sku;
  this.state.lastRes = await this.admin.post('/v1/admin/products', {
    data: { ...nuevoProducto(c.id), sku },
  });
});

When('creo otro producto con el mismo SKU', async function (this: CatalogWorld) {
  const c = this.state.category as Category;
  this.state.lastRes = await this.admin.post('/v1/admin/products', {
    data: { ...nuevoProducto(c.id), sku: this.state.dupSku as string },
  });
});

Then('la respuesta es {int}', function (this: CatalogWorld, code: number) {
  const res = this.state.lastRes as { status(): number };
  assert.equal(res.status(), code, `esperaba ${code}, fue ${res.status()}`);
});

When('intento publicar un producto archivado', async function (this: CatalogWorld) {
  const p = this.state.product as Product;
  await this.admin.patch(`/v1/admin/products/${p.id}`, { data: { status: 'archived' } });
  this.state.lastRes = await this.admin.patch(`/v1/admin/products/${p.id}`, { data: { status: 'published' } });
});

// --- RBAC ---

When('un visitante sin sesión pide {word} {string}', async function (this: CatalogWorld, method: string, path: string) {
  const m = method.toLowerCase() as 'get' | 'post' | 'patch';
  this.state.lastRes = await this.anon[m](path, { data: {} });
});

// --- Auth source (X-6) ---

Then('el fixture de auth resuelve por login real', async function () {
  const { source } = await adminAuthWithSource();
  assert.equal(source, 'real-login', `auth source fue "${source}", no login real`);
});
