import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ImportProgress } from './ImportProgress';
import type { ImportJob } from './importsService';

function job(over: Partial<ImportJob> = {}): ImportJob {
  return {
    id: '2f1c9a4e-1111-4111-8111-111111111111',
    status: 'running',
    filename: 'catalogo.csv',
    source_format: 'csv',
    total_rows: null,
    processed_rows: 120,
    created_count: 100,
    updated_count: 18,
    failed_count: 2,
    categories_created_count: 1,
    error_code: null,
    error_message: null,
    report_truncated: false,
    started_at: '2026-08-23T10:00:00.000Z',
    finished_at: null,
    created_at: '2026-08-23T10:00:00.000Z',
    errors: [],
    pagination: { limit: 50, offset: 0, total: 0 },
    ...over,
  };
}

describe('ImportProgress — indeterminado hasta que el total existe', () => {
  it('con total_rows null NO expone aria-valuenow', () => {
    render(<ImportProgress job={job({ total_rows: null })} />);

    const barra = screen.getByRole('progressbar');
    // Escribir 0 acá le mentiría al lector de pantalla: no es que no haya
    // avanzado, es que todavía no se sabe cuánto falta.
    expect(barra).not.toHaveAttribute('aria-valuenow');
    expect(barra).not.toHaveAttribute('aria-valuemax');
    expect(barra).toHaveAttribute('aria-valuemin', '0');
  });

  it('con total_rows expone valuenow y valuemax', () => {
    render(<ImportProgress job={job({ total_rows: 500, processed_rows: 120 })} />);

    const barra = screen.getByRole('progressbar');
    expect(barra).toHaveAttribute('aria-valuenow', '120');
    expect(barra).toHaveAttribute('aria-valuemax', '500');
  });

  it('el texto refleja los dos modos', () => {
    const { rerender } = render(
      <ImportProgress job={job({ total_rows: null, processed_rows: 320 })} />,
    );
    expect(screen.getByRole('status')).toHaveTextContent(/320 filas leídas/);

    rerender(
      <ImportProgress job={job({ total_rows: 500, processed_rows: 250 })} />,
    );
    expect(screen.getByRole('status')).toHaveTextContent(/250 de 500 filas/);
    expect(screen.getByRole('status')).toHaveTextContent(/50%/);
  });
});

describe('ImportProgress — anuncio y contadores', () => {
  it('el avance queda ANUNCIADO en una región viva', () => {
    const { rerender } = render(
      <ImportProgress job={job({ processed_rows: 100 })} />,
    );
    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveTextContent(/100/);

    rerender(<ImportProgress job={job({ processed_rows: 480 })} />);

    // Sin este cambio de texto en la región viva, el progreso no existe para
    // quien no mira la pantalla.
    expect(screen.getByRole('status')).toHaveTextContent(/480/);
  });

  it('muestra los contadores parciales mientras corre (AC-7)', () => {
    render(
      <ImportProgress
        job={job({ created_count: 100, updated_count: 18, failed_count: 2 })}
      />,
    );

    expect(screen.getByText('Creados')).toBeInTheDocument();
    expect(screen.getByText('100')).toBeInTheDocument();
    expect(screen.getByText('Actualizados')).toBeInTheDocument();
    expect(screen.getByText('18')).toBeInTheDocument();
    expect(screen.getByText('Rechazados')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('no pasa del 100% si el servidor reporta más procesadas que el total', () => {
    // Defensa contra un total que llegó antes de estabilizarse: una barra al 140%
    // se sale del contenedor y se ve como un bug.
    render(<ImportProgress job={job({ total_rows: 100, processed_rows: 140 })} />);
    expect(screen.getByRole('status')).toHaveTextContent(/100%/);
  });

  it('cuando el seguimiento se agotó, avisa que el trabajo SIGUE corriendo', () => {
    render(<ImportProgress job={job()} agotado />);

    const aviso = screen.getByRole('alert');
    expect(aviso).toHaveTextContent(/sigue/i);
    expect(aviso).toHaveTextContent(/volvé a entrar/i);
  });
});
