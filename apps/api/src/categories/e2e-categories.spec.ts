import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { adminToken, bootTestApp, customerToken } from '../../test/e2e-app';
import { CategoriesModule } from './categories.module';
import { PrismaService } from '../prisma/prisma.service';

describe('Categories (e2e-categories)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await bootTestApp([CategoriesModule]);
    prisma = app.get(PrismaService);
  });
  afterAll(async () => {
    await app?.close();
  });
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE products, categories RESTART IDENTITY CASCADE',
    );
  });

  it('POST crea categoría 201 con slug único derivado', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/admin/categories')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ name: 'Refrigeración' });
    expect(res.status).toBe(201);
    expect(res.body.slug).toBe('refrigeracion');
  });

  it('POST con slug duplicado → 409', async () => {
    const auth = `Bearer ${adminToken()}`;
    await request(app.getHttpServer())
      .post('/v1/admin/categories')
      .set('Authorization', auth)
      .send({ name: 'Ferretería' });
    const res = await request(app.getHttpServer())
      .post('/v1/admin/categories')
      .set('Authorization', auth)
      .send({ name: 'Ferreteria' });
    expect(res.status).toBe(409);
    expect(res.body.type).toBe('dsm:catalog/conflict');
  });

  it('sin sesión admin → 401', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/admin/categories')
      .send({ name: 'X' });
    expect(res.status).toBe(401);
  });

  it('rol no-admin → 403', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/admin/categories')
      .set('Authorization', `Bearer ${customerToken()}`)
      .send({ name: 'X' });
    expect(res.status).toBe(403);
  });
});
