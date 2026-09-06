import type { SalesGranularity } from './metricsService';

const MESES_ABREVIADOS = [
  'ene',
  'feb',
  'mar',
  'abr',
  'may',
  'jun',
  'jul',
  'ago',
  'sep',
  'oct',
  'nov',
  'dic',
];

/** `DD/MM`, cero-rellenado — construido a mano: el `2-digit` de `Intl` no
 * rellena de forma consistente entre entornos ICU para `es-AR`. */
function ddmm(date: Date): string {
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}`;
}

/**
 * Formatea `period_date` (siempre `YYYY-MM-DD`, `date_trunc` del backend)
 * según la granularidad pedida (`Intl.DateTimeFormat('es-AR', …)` para el
 * nombre del mes; el día/mes numérico se arma a mano para garantizar el
 * cero-relleno):
 * - `day`: el día en sí → `DD/MM`.
 * - `week`: el lunes de esa semana (`date_trunc('week', …)`) → "semana del DD/MM".
 * - `month`: el primer día de ese mes → `MMM AAAA`.
 */
export function formatPeriod(periodDate: string, granularity: SalesGranularity): string {
  const date = new Date(`${periodDate}T00:00:00Z`);

  switch (granularity) {
    case 'day':
      return ddmm(date);
    case 'week':
      return `semana del ${ddmm(date)}`;
    case 'month':
      return `${MESES_ABREVIADOS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
    default:
      return periodDate;
  }
}
