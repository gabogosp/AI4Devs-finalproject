import { ConfigService } from '@nestjs/config';
import { ReportsRepository } from './reports.repository';
import { ReportsEventsService } from '../observability/report-events.service';
import { ReportsService } from './reports.service';

function buildService() {
  const repo = {
    salesTimeseries: jest.fn(),
    topProducts: jest.fn(),
    statusBreakdown: jest.fn(),
  } as unknown as jest.Mocked<ReportsRepository>;

  const events = new ReportsEventsService();
  jest.spyOn(events, 'emit');

  const config = new ConfigService({ ORDER_RETENTION_MONTHS: 12 });
  const service = new ReportsService(repo, events, config);

  return { repo, events, service };
}

describe('ReportsService', () => {
  describe('getSalesTimeseries / getSalesTimeseriesCsv (AC-1, AC-4, AC-5, AC-6, AC-9)', () => {
    it('rango sin datos → data:[], sin lanzar, y emite reports.viewed', async () => {
      const { repo, events, service } = buildService();
      repo.salesTimeseries.mockResolvedValue([]);

      const result = await service.getSalesTimeseries({ granularity: 'day' });

      expect(result.data).toEqual([]);
      expect(repo.salesTimeseries).toHaveBeenCalledTimes(1);
      expect(events.emit).toHaveBeenCalledWith('reports.viewed', 'sales');
    });

    it('el export reusa la misma query (1 sola invocación) y emite reports.exported, no .viewed', async () => {
      const { repo, events, service } = buildService();
      repo.salesTimeseries.mockResolvedValue([
        { period_date: new Date('2026-08-05T00:00:00.000Z'), orders_count: 2, total_ars_cents: 5000 },
      ]);

      const csv = await service.getSalesTimeseriesCsv({ granularity: 'day' });

      expect(repo.salesTimeseries).toHaveBeenCalledTimes(1);
      expect(csv.body).toContain('period_date,orders_count,total_ars_cents');
      expect(csv.body).toContain('2026-08-05,2,5000');
      expect(events.emit).toHaveBeenCalledWith('reports.exported', 'sales');
      expect(events.emit).not.toHaveBeenCalledWith('reports.viewed', 'sales');
    });
  });

  describe('getTopProducts / getTopProductsCsv (AC-2, AC-4, AC-5, AC-6, AC-9)', () => {
    it('rango sin datos → data:[]', async () => {
      const { repo, service } = buildService();
      repo.topProducts.mockResolvedValue([]);

      const result = await service.getTopProducts({ limit: 10 });

      expect(result.data).toEqual([]);
    });

    it('delega el limit del query en el repositorio', async () => {
      const { repo, service } = buildService();
      repo.topProducts.mockResolvedValue([]);

      await service.getTopProducts({ limit: 3 });

      expect(repo.topProducts).toHaveBeenCalledWith(expect.anything(), 3);
    });

    it('el export emite reports.exported, no .viewed', async () => {
      const { repo, events, service } = buildService();
      repo.topProducts.mockResolvedValue([]);

      await service.getTopProductsCsv({ limit: 10 });

      expect(events.emit).toHaveBeenCalledWith('reports.exported', 'top-products');
      expect(events.emit).not.toHaveBeenCalledWith('reports.viewed', 'top-products');
    });
  });

  describe('getSummary / getSummaryCsv — zero-fill (AC-3, AC-5, AC-8)', () => {
    it('con 0 órdenes: orders_count=0, total_ars_cents=0, breakdown con las 4 claves en cero', async () => {
      const { repo, service } = buildService();
      repo.statusBreakdown.mockResolvedValue([]);

      const result = await service.getSummary({});

      expect(result.orders_count).toBe(0);
      expect(result.total_ars_cents).toBe(0);
      expect(Object.keys(result.breakdown_by_status)).toHaveLength(4);
      expect(result.breakdown_by_status).toEqual({
        new: { count: 0, total_ars_cents: 0 },
        preparing: { count: 0, total_ars_cents: 0 },
        ready: { count: 0, total_ars_cents: 0 },
        delivered: { count: 0, total_ars_cents: 0 },
      });
    });

    it('con filas parciales: completa los estados ausentes en cero, totales = suma de las 4 entradas', async () => {
      const { repo, service } = buildService();
      repo.statusBreakdown.mockResolvedValue([
        { status: 'new', count: 2, total_ars_cents: 10_000 },
        { status: 'delivered', count: 1, total_ars_cents: 5_000 },
      ]);

      const result = await service.getSummary({});

      expect(Object.keys(result.breakdown_by_status)).toHaveLength(4);
      expect(result.breakdown_by_status.preparing).toEqual({ count: 0, total_ars_cents: 0 });
      expect(result.breakdown_by_status.ready).toEqual({ count: 0, total_ars_cents: 0 });
      expect(result.orders_count).toBe(3);
      expect(result.total_ars_cents).toBe(15_000);
    });

    it('el export CSV reusa la misma agregación (1 sola invocación) y emite reports.exported', async () => {
      const { repo, events, service } = buildService();
      repo.statusBreakdown.mockResolvedValue([]);

      const csv = await service.getSummaryCsv({});

      expect(repo.statusBreakdown).toHaveBeenCalledTimes(1);
      expect(csv.body).toContain('status,count,total_ars_cents');
      expect(csv.body).toContain('total,0,0');
      expect(events.emit).toHaveBeenCalledWith('reports.exported', 'summary');
      expect(events.emit).not.toHaveBeenCalledWith('reports.viewed', 'summary');
    });
  });
});
