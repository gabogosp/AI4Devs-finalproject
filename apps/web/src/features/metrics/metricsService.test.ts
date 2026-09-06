import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { metricsService } from './metricsService';

const API = 'http://localhost:3000';

const SALES_RESPONSE = {
  range: { from: '2026-08-01T00:00:00Z', to: '2026-08-31T23:59:59Z' },
  granularity: 'day',
  data: [{ period_date: '2026-08-01', orders_count: 3, total_ars_cents: 15_000 }],
};

const TOP_PRODUCTS_RESPONSE = {
  range: { from: '2026-08-01T00:00:00Z', to: '2026-08-31T23:59:59Z' },
  data: [
    {
      product_id: 'a1111111-1111-4111-8111-111111111111',
      product_name: 'Heladera',
      product_sku: 'REF-1',
      quantity_sold: 10,
      revenue_ars_cents: 500_000,
    },
  ],
};

const SUMMARY_RESPONSE = {
  range: { from: '2026-08-01T00:00:00Z', to: '2026-08-31T23:59:59Z' },
  orders_count: 12,
  total_ars_cents: 600_000,
  breakdown_by_status: {
    new: { count: 1, total_ars_cents: 10_000 },
    preparing: { count: 2, total_ars_cents: 20_000 },
    ready: { count: 3, total_ars_cents: 30_000 },
    delivered: { count: 6, total_ars_cents: 540_000 },
  },
};

const INVALID_RANGE_PROBLEM = {
  type: 'dsm:reports/invalid-range',
  title: 'Unprocessable Entity',
  status: 422,
  detail: 'created_at_from no puede ser posterior a created_at_to.',
  instance: '/v1/admin/reports/sales',
};

describe('metricsService', () => {
  it('getSales manda el rango/granularidad y parsea la respuesta', async () => {
    let url = '';
    server.use(
      http.get(`${API}/v1/admin/reports/sales`, ({ request }) => {
        url = request.url;
        return HttpResponse.json(SALES_RESPONSE);
      }),
    );

    const resultado = await metricsService.getSales(
      { from: '2026-08-01', to: '2026-08-31' },
      'day',
    );

    expect(url).toContain('created_at_from=2026-08-01');
    expect(url).toContain('created_at_to=2026-08-31');
    expect(url).toContain('granularity=day');
    expect(resultado.data).toHaveLength(1);
  });

  it('getSales propaga un 422 dsm:reports/invalid-range como AppError validation', async () => {
    server.use(
      http.get(`${API}/v1/admin/reports/sales`, () =>
        HttpResponse.json(INVALID_RANGE_PROBLEM, {
          status: 422,
          headers: { 'content-type': 'application/problem+json' },
        }),
      ),
    );

    await expect(
      metricsService.getSales({ from: '2026-09-01', to: '2026-08-01' }),
    ).rejects.toMatchObject({
      appError: { kind: 'validation', problemType: 'dsm:reports/invalid-range' },
    });
  });

  it('exportSales devuelve el CSV como texto y el nombre del servidor', async () => {
    const csv = 'periodo,ordenes,monto\n2026-08-01,3,15000\n';
    server.use(
      http.get(`${API}/v1/admin/reports/sales/export`, () =>
        new HttpResponse(csv, {
          status: 200,
          headers: {
            'content-type': 'text/csv; charset=utf-8',
            'content-disposition': 'attachment; filename="ventas-2026-08.csv"',
          },
        }),
      ),
    );

    const resultado = await metricsService.exportSales({});

    expect(resultado.csv).toBe(csv);
    expect(resultado.filename).toBe('ventas-2026-08.csv');
  });

  it('exportSales usa un nombre de respaldo si el servidor no manda Content-Disposition', async () => {
    server.use(
      http.get(`${API}/v1/admin/reports/sales/export`, () =>
        new HttpResponse('periodo,ordenes,monto\n', {
          status: 200,
          headers: { 'content-type': 'text/csv; charset=utf-8' },
        }),
      ),
    );

    const resultado = await metricsService.exportSales({});

    expect(resultado.filename).toBe('ventas.csv');
  });

  it('getTopProducts manda el rango y parsea la respuesta', async () => {
    server.use(
      http.get(`${API}/v1/admin/reports/top-products`, () =>
        HttpResponse.json(TOP_PRODUCTS_RESPONSE),
      ),
    );

    const resultado = await metricsService.getTopProducts({});

    expect(resultado.data).toHaveLength(1);
    expect(resultado.data[0].quantity_sold).toBe(10);
  });

  it('getTopProducts propaga un 422 como AppError validation', async () => {
    server.use(
      http.get(`${API}/v1/admin/reports/top-products`, () =>
        HttpResponse.json(
          { ...INVALID_RANGE_PROBLEM, instance: '/v1/admin/reports/top-products' },
          { status: 422, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );

    await expect(metricsService.getTopProducts({})).rejects.toMatchObject({
      appError: { kind: 'validation' },
    });
  });

  it('exportTopProducts devuelve el CSV con el nombre del servidor', async () => {
    const csv = 'producto,sku,cantidad,monto\nHeladera,REF-1,10,500000\n';
    server.use(
      http.get(`${API}/v1/admin/reports/top-products/export`, () =>
        new HttpResponse(csv, {
          status: 200,
          headers: {
            'content-type': 'text/csv; charset=utf-8',
            'content-disposition': 'attachment; filename="productos.csv"',
          },
        }),
      ),
    );

    const resultado = await metricsService.exportTopProducts({});

    expect(resultado.csv).toBe(csv);
    expect(resultado.filename).toBe('productos.csv');
  });

  it('getSummary manda el rango y parsea la respuesta', async () => {
    server.use(
      http.get(`${API}/v1/admin/reports/summary`, () =>
        HttpResponse.json(SUMMARY_RESPONSE),
      ),
    );

    const resultado = await metricsService.getSummary({});

    expect(resultado.orders_count).toBe(12);
    expect(resultado.breakdown_by_status.delivered.count).toBe(6);
  });

  it('getSummary propaga un 422 como AppError validation', async () => {
    server.use(
      http.get(`${API}/v1/admin/reports/summary`, () =>
        HttpResponse.json(
          { ...INVALID_RANGE_PROBLEM, instance: '/v1/admin/reports/summary' },
          { status: 422, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );

    await expect(metricsService.getSummary({})).rejects.toMatchObject({
      appError: { kind: 'validation' },
    });
  });

  it('exportSummary devuelve el CSV con el nombre del servidor', async () => {
    const csv = 'ordenes,monto\n12,600000\n';
    server.use(
      http.get(`${API}/v1/admin/reports/summary/export`, () =>
        new HttpResponse(csv, {
          status: 200,
          headers: {
            'content-type': 'text/csv; charset=utf-8',
            'content-disposition': 'attachment; filename="resumen-2026-08.csv"',
          },
        }),
      ),
    );

    const resultado = await metricsService.exportSummary({});

    expect(resultado.csv).toBe(csv);
    expect(resultado.filename).toBe('resumen-2026-08.csv');
  });
});
