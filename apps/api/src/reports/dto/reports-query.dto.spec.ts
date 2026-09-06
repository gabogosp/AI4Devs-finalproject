import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ReportsRangeQueryDto, SalesQueryDto, TopProductsQueryDto } from './reports-query.dto';

/**
 * T6.1 — el contrato del borde ejercido sin HTTP, mismo patrón que
 * `orders/dto/order.dto.spec.ts`: `plainToInstance` + `validate` es
 * exactamente lo que hace el `ValidationPipe` global.
 */
const violacionesRange = async (payload: unknown) =>
  validate(plainToInstance(ReportsRangeQueryDto, payload), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });

const violacionesSales = async (payload: unknown) =>
  validate(plainToInstance(SalesQueryDto, payload), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });

const violacionesTopProducts = async (payload: unknown) =>
  validate(plainToInstance(TopProductsQueryDto, payload), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });

describe('ReportsRangeQueryDto', () => {
  it('sin query params: construye sin error', async () => {
    expect(await violacionesRange({})).toHaveLength(0);
  });

  it('created_at_from/created_at_to que no parsean ISO 8601 → violación', async () => {
    expect(await violacionesRange({ created_at_from: 'no-es-una-fecha' })).not.toHaveLength(0);
    expect(await violacionesRange({ created_at_to: '2026/08/01' })).not.toHaveLength(0);
    expect(
      await violacionesRange({
        created_at_from: '2026-08-01T00:00:00.000Z',
        created_at_to: '2026-08-31T00:00:00.000Z',
      }),
    ).toHaveLength(0);
  });
});

describe('SalesQueryDto', () => {
  it('sin granularity: default "day"', async () => {
    const dto = plainToInstance(SalesQueryDto, {});
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.granularity).toBe('day');
  });

  it('granularity fuera del enum [day, week, month] → violación', async () => {
    expect(await violacionesSales({ granularity: 'year' })).not.toHaveLength(0);
    expect(await violacionesSales({ granularity: 'week' })).toHaveLength(0);
  });
});

describe('TopProductsQueryDto', () => {
  it('sin limit: default 10', async () => {
    const dto = plainToInstance(TopProductsQueryDto, {});
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.limit).toBe(10);
  });

  it('limit fuera de [1, 50] → violación', async () => {
    expect(await violacionesTopProducts({ limit: 0 })).not.toHaveLength(0);
    expect(await violacionesTopProducts({ limit: 51 })).not.toHaveLength(0);
    expect(await violacionesTopProducts({ limit: 50 })).toHaveLength(0);
  });
});
