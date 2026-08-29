import { Body, Controller, INestApplication, Post } from '@nestjs/common';
import { IsInt, IsNotEmpty, IsString, Min } from 'class-validator';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { configureApp } from '../../bootstrap';

class SampleDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsInt()
  @Min(1)
  price_ars_cents!: number;
}

@Controller('test-validation')
class SampleController {
  @Post()
  create(@Body() dto: SampleDto): SampleDto {
    return dto;
  }
}

describe('ValidationPipe global (e2e-validation)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [SampleController],
    }).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('rechaza un campo desconocido (forbidNonWhitelisted) con envelope RFC 7807', async () => {
    const res = await request(app.getHttpServer())
      .post('/test-validation')
      .send({ name: 'x', price_ars_cents: 10, unexpected: 'y' });
    expect([400, 422]).toContain(res.status);
    expect(res.body.type).toMatch(/^dsm:catalog\//);
    expect(res.body.status).toBe(res.status);
    expect(Array.isArray(res.body.errors)).toBe(true);
  });

  it('acepta un body válido', async () => {
    const res = await request(app.getHttpServer())
      .post('/test-validation')
      .send({ name: 'x', price_ars_cents: 10 });
    expect(res.status).toBe(201);
  });
});
