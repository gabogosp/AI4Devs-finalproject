import { Controller, Get, Header, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../auth/admin.guard';
import { MetricsService } from './metrics.service';

/**
 * Exposición de las métricas de aplicación (AUDIT-dsm-api-006).
 *
 * **Detrás de `AdminGuard`, y es una decisión discutible que conviene dejar dicha.**
 * Lo habitual es que `/metrics` sea abierto dentro de la red privada, porque los
 * scrapers no suelen autenticarse. Acá va protegido porque en Railway la superficie
 * es pública: un `/metrics` abierto le contaría a cualquiera el volumen de ventas,
 * cuántos logins fallan y cuánto stock se bloquea — inteligencia de negocio gratis.
 *
 * Consecuencia asumida: cuando exista un scraper habrá que darle credencial de admin
 * o mover el endpoint a una ruta interna. Es un problema de ese día, y preferible a
 * publicar el pulso del negocio hoy.
 *
 * Vive bajo `/v1/admin/*`, así que hereda el `Cache-Control: no-store` que el borde
 * ya estampa en ese prefijo.
 */
@Controller('v1/admin/metrics')
@UseGuards(AdminGuard)
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  async scrape(): Promise<string> {
    return this.metrics.render();
  }
}
