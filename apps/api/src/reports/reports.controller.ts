import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { AdminGuard } from '../auth/admin.guard';
import { ReportsRangeQueryDto, SalesQueryDto, TopProductsQueryDto } from './dto/reports-query.dto';
import {
  ReportsService,
  SalesResponse,
  SummaryResponse,
  TopProductsResponse,
} from './reports.service';

function sendCsv(res: Response, filename: string, body: string): void {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(body);
}

/**
 * 6 endpoints GET del panel de métricas del dueño (AC-1 a AC-9) — controller
 * delgado, mismo estilo que `MetricsController`/`ProductsController`
 * (`backend-node-standards.md §2`). Los 3 `/export` sirven `text/csv` con
 * `@Res()`, mismo patrón que `imports.controller.ts` (`:id/report`).
 *
 * Montado en `v1/admin/reports` — sin colisión de clase ni de URL con
 * `MetricsController` de `observability/` (`GET /v1/admin/metrics`, el
 * scrape Prometheus, sin tocar — `design.md §D1`).
 */
@Controller('v1/admin/reports')
@UseGuards(AdminGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('sales')
  sales(@Query() query: SalesQueryDto): Promise<SalesResponse> {
    return this.reports.getSalesTimeseries(query);
  }

  @Get('sales/export')
  async salesExport(@Query() query: SalesQueryDto, @Res() res: Response): Promise<void> {
    const csv = await this.reports.getSalesTimeseriesCsv(query);
    sendCsv(res, csv.filename, csv.body);
  }

  @Get('top-products')
  topProducts(@Query() query: TopProductsQueryDto): Promise<TopProductsResponse> {
    return this.reports.getTopProducts(query);
  }

  @Get('top-products/export')
  async topProductsExport(
    @Query() query: TopProductsQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const csv = await this.reports.getTopProductsCsv(query);
    sendCsv(res, csv.filename, csv.body);
  }

  @Get('summary')
  summary(@Query() query: ReportsRangeQueryDto): Promise<SummaryResponse> {
    return this.reports.getSummary(query);
  }

  @Get('summary/export')
  async summaryExport(@Query() query: ReportsRangeQueryDto, @Res() res: Response): Promise<void> {
    const csv = await this.reports.getSummaryCsv(query);
    sendCsv(res, csv.filename, csv.body);
  }
}
