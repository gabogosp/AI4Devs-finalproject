import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ImportErrorsTable } from './ImportErrorsTable';
import type { ImportJob, ImportRowError } from './importsService';

function fila(over: Partial<ImportRowError> = {}): ImportRowError {
  return {
    row_number: 2,
    sku: 'REF-1',
    field: 'precio',
    error_code: 'invalid_price',
    error_message: 'el precio tiene que ser un número mayor a 0',
    ...over,
  };
}

function job(over: Partial<ImportJob> = {}): ImportJob {
  return {
    id: '2f1c9a4e-1111-4111-8111-111111111111',
    status: 'completed',
    filename: 'catalogo.csv',
    source_format: 'csv',
    total_rows: 200,
    processed_rows: 200,
    created_count: 80,
    updated_count: 0,
    failed_count: 120,
    categories_created_count: 0,
    error_code: null,
    error_message: null,
    report_truncated: false,
    started_at: '2026-08-23T10:00:00.000Z',
    finished_at: '2026-08-23T10:00:20.000Z',
    created_at: '2026-08-23T10:00:00.000Z',
    errors: Array.from({ length: 50 }, (_, i) =>
      fila({ row_number: i + 2, sku: `MAL-${i + 1}` }),
    ),
    pagination: { limit: 50, offset: 0, total: 120 },
    ...over,
  };
}

describe('ImportErrorsTable — datos y paginación', () => {
  it('muestra 50 filas de 120 y las cinco columnas con encabezado real', () => {
    render(
      <ImportErrorsTable job={job()} offset={0} onOffsetChange={vi.fn()} />,
    );

    expect(screen.getAllByRole('columnheader')).toHaveLength(5);
    expect(screen.getAllByRole('row')).toHaveLength(51); // 50 + encabezado
    expect(screen.getByText(/1–50 de 120/)).toBeInTheDocument();
  });

  it('«Siguientes» pide el offset siguiente y «Anteriores» está deshabilitado en la primera página', async () => {
    const onOffsetChange = vi.fn();
    render(
      <ImportErrorsTable job={job()} offset={0} onOffsetChange={onOffsetChange} />,
    );

    expect(screen.getByRole('button', { name: /anteriores/i })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: /siguientes/i }));

    expect(onOffsetChange).toHaveBeenCalledWith(50);
  });

  it('en la última página «Siguientes» se deshabilita', () => {
    render(
      <ImportErrorsTable
        job={job({
          errors: Array.from({ length: 20 }, (_, i) => fila({ row_number: 102 + i })),
          pagination: { limit: 50, offset: 100, total: 120 },
        })}
        offset={100}
        onOffsetChange={vi.fn()}
      />,
    );

    expect(screen.getByText(/101–120 de 120/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /siguientes/i })).toBeDisabled();
  });

  it('traduce el código y además deja el motivo del servidor a la vista', () => {
    render(
      <ImportErrorsTable
        job={job({
          errors: [fila({ error_code: 'invalid_price', error_message: 'mal el precio' })],
          pagination: { limit: 50, offset: 0, total: 1 },
          failed_count: 1,
        })}
        offset={0}
        onOffsetChange={vi.fn()}
      />,
    );

    expect(screen.getByText('El precio no es válido')).toBeInTheDocument();
    expect(screen.getByText('mal el precio')).toBeInTheDocument();
  });

  it('un código desconocido no deja la celda vacía: cae al motivo del servidor', () => {
    render(
      <ImportErrorsTable
        job={job({
          errors: [
            fila({ error_code: 'codigo_nuevo', error_message: 'motivo del backend' }),
          ],
          pagination: { limit: 50, offset: 0, total: 1 },
          failed_count: 1,
        })}
        offset={0}
        onOffsetChange={vi.fn()}
      />,
    );

    expect(screen.getAllByText('motivo del backend').length).toBeGreaterThan(0);
  });

  it('un sku o un campo nulos se muestran con un guion, no como "null"', () => {
    render(
      <ImportErrorsTable
        job={job({
          errors: [fila({ sku: null, field: null })],
          pagination: { limit: 50, offset: 0, total: 1 },
          failed_count: 1,
        })}
        offset={0}
        onOffsetChange={vi.fn()}
      />,
    );

    expect(screen.queryByText('null')).not.toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
  });
});

describe('ImportErrorsTable — seguridad y bordes', () => {
  it('un sku con markup se muestra como TEXTO y no se ejecuta', () => {
    const malicioso = '<img src=x onerror="alert(1)">';
    const { container } = render(
      <ImportErrorsTable
        job={job({
          errors: [fila({ sku: malicioso })],
          pagination: { limit: 50, offset: 0, total: 1 },
          failed_count: 1,
        })}
        offset={0}
        onOffsetChange={vi.fn()}
      />,
    );

    // El contenido viene del archivo de un proveedor: es una fuente que no
    // controlamos. Se ve literal y no hay ningún nodo creado a partir de él.
    expect(screen.getByText(malicioso)).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
  });

  it('sin filas rechazadas muestra un estado afirmativo, no una tabla vacía', () => {
    render(
      <ImportErrorsTable
        job={job({ failed_count: 0, errors: [], pagination: { limit: 50, offset: 0, total: 0 } })}
        offset={0}
        onOffsetChange={vi.fn()}
      />,
    );

    expect(screen.getByText(/ninguna fila fue rechazada/i)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('cuando el reporte está recortado, lo avisa con los dos números', () => {
    render(
      <ImportErrorsTable
        job={job({
          failed_count: 5_000,
          report_truncated: true,
          pagination: { limit: 50, offset: 0, total: 1_000 },
        })}
        offset={0}
        onOffsetChange={vi.fn()}
      />,
    );

    const aviso = screen.getByRole('alert');
    expect(aviso).toHaveTextContent(/5000/);
    expect(aviso).toHaveTextContent(/1000/);
    expect(aviso).toHaveTextContent(/CSV/);
  });
});
