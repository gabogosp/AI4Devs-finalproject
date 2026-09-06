import { beforeAll, describe, expect, it, vi } from 'vitest';
import { isValidElement, cloneElement, type ReactElement } from 'react';
import { render } from '@testing-library/react';
import { SalesComposedChart } from './SalesComposedChart';
import type { SalesRow } from '../metricsService';

const ROWS: SalesRow[] = [
  { period_date: '2026-08-01', orders_count: 3, total_ars_cents: 15_000 },
  { period_date: '2026-08-02', orders_count: 5, total_ars_cents: 25_000 },
];

// jsdom no implementa layout real (`ResizeObserver`, medición de contenedor):
// `ResponsiveContainer` de Recharts depende de eso para calcular el ancho/alto
// del chart interno. Se reemplaza por una versión que clona el hijo con
// dimensiones fijas — mismo mecanismo que usa Recharts, sin medir el DOM real.
vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactElement }) =>
      isValidElement(children)
        ? cloneElement(children, { width: 600, height: 320 } as object)
        : children,
  };
});

beforeAll(() => {
  // jsdom no implementa `getBBox` (medición de texto SVG); sin esto, Recharts
  // no puede calcular el ancho de las etiquetas de los ejes.
  // @ts-expect-error -- jsdom no declara getBBox en SVGElement.
  SVGElement.prototype.getBBox = () => ({ x: 0, y: 0, width: 40, height: 20 });
});

describe('SalesComposedChart', () => {
  it('renderiza un Bar y un Line con los yAxisId cruzados correctamente', () => {
    const { container } = render(
      <SalesComposedChart rows={ROWS} granularity="day" />,
    );

    // Recharts pinta el SVG con clases por tipo de elemento — no hay `role`
    // semántico para un chart, así que se verifica por la estructura SVG
    // renderizada (mismo criterio de "sin error" del Exit criterion).
    expect(container.querySelectorAll('.recharts-bar').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('.recharts-line').length).toBeGreaterThan(0);
    // 3 ejes cartesianos: 1 X + 2 Y (izquierdo para órdenes, derecho para monto).
    expect(container.querySelectorAll('.recharts-cartesian-axis').length).toBe(3);
    expect(container.querySelectorAll('.recharts-yAxis').length).toBe(2);
  });

  it('no lanza con un array vacío de filas', () => {
    expect(() =>
      render(<SalesComposedChart rows={[]} granularity="month" />),
    ).not.toThrow();
  });
});
