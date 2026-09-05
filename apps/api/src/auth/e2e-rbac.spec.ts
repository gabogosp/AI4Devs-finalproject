import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { customerToken, bootTestApp } from '../../test/e2e-app';
import { CategoriesModule } from '../categories/categories.module';
import { MetricsModule } from '../observability/metrics.module';
import { ProductsModule } from '../products/products.module';
import { OrdersModule } from '../orders/orders.module';

type Method = 'get' | 'post' | 'patch';

/**
 * AC-8: barrido de TODAS las rutas /v1/admin/* — sin token → 401, con token
 * no-admin → 403. Ninguna operación de administración se expone sin auth.
 */
describe('RBAC admin end-to-end (e2e-rbac, AC-8)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await bootTestApp([CategoriesModule, MetricsModule, ProductsModule, OrdersModule]);
  });
  afterAll(async () => {
    await app?.close();
  });

  const uuid = '00000000-0000-0000-0000-000000000001';
  const routes: Array<[Method, string]> = [
    ['post', '/v1/admin/categories'],
    ['get', '/v1/admin/categories'],
    ['patch', `/v1/admin/categories/${uuid}`],
    ['post', '/v1/admin/products'],
    ['get', '/v1/admin/products'],
    ['get', `/v1/admin/products/${uuid}`],
    ['patch', `/v1/admin/products/${uuid}`],
    // AUDIT-dsm-api-006 — la exposición de métricas entra al MISMO barrido en vez de
    // llevar su propio spec: así el invariante «ninguna ruta /v1/admin/* responde sin
    // auth» se mantiene por construcción cuando alguien agregue la próxima. Importa
    // especialmente acá: un /metrics abierto publicaría volumen de ventas, logins
    // fallidos y stock bloqueado — inteligencia de negocio gratis.
    ['get', '/v1/admin/metrics'],
    // US-012 — panel de órdenes del dueño.
    ['get', '/v1/admin/orders'],
    ['get', `/v1/admin/orders/${uuid}`],
    ['patch', `/v1/admin/orders/${uuid}`],
  ];

  function call(method: Method, path: string): request.Test {
    const agent = request(app.getHttpServer());
    return agent[method](path);
  }

  it.each(routes)('sin token: %s %s → 401', async (method, path) => {
    const res = await call(method, path).send({});
    expect(res.status).toBe(401);
  });

  it.each(routes)('token no-admin: %s %s → 403', async (method, path) => {
    const res = await call(method, path)
      .set('Authorization', `Bearer ${customerToken()}`)
      .send({});
    expect(res.status).toBe(403);
  });
});
