import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatArs } from '@/lib/format/currency';
import type { SalesRow, SalesGranularity } from '../metricsService';
import { formatPeriod } from '../formatPeriod';

export interface SalesComposedChartProps {
  rows: SalesRow[];
  granularity: SalesGranularity;
}

/** Colores data-viz del design-system §9. */
const COLOR_ORDERS = '#1A56DB';
const COLOR_REVENUE = '#EA580C';

/**
 * Primitivo puro de Recharts (sin fetch, sin estado): `ComposedChart` con
 * `Bar` (cantidad de órdenes, eje izquierdo) + `Line` (monto facturado ARS,
 * eje derecho) — dual-axis, `design.md` T6.2.
 */
export function SalesComposedChart({ rows, granularity }: SalesComposedChartProps) {
  const data = rows.map((row) => ({
    ...row,
    label: formatPeriod(row.period_date, granularity),
  }));

  return (
    <ResponsiveContainer width="100%" height={320}>
      <ComposedChart data={data}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="label" />
        <YAxis yAxisId="left" allowDecimals={false} />
        <YAxis
          yAxisId="right"
          orientation="right"
          tickFormatter={(v: number) => formatArs(v)}
        />
        <Tooltip
          formatter={(value, name) =>
            name === 'total_ars_cents' ? formatArs(Number(value)) : value
          }
        />
        <Legend />
        <Bar
          yAxisId="left"
          dataKey="orders_count"
          name="Órdenes"
          fill={COLOR_ORDERS}
        />
        <Line
          yAxisId="right"
          type="monotone"
          dataKey="total_ars_cents"
          name="Monto facturado"
          stroke={COLOR_REVENUE}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
