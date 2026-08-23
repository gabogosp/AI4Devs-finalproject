import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '@/test/server';
import { setEventSink } from '@/lib/observability/events';
import { ImportResult } from './ImportResult';
import type { ImportJob } from './importsService';

const API = 'http://localhost:3000';
const ID = '2f1c9a4e-1111-4111-8111-111111111111';

const revalidateCatalogSafely = vi.hoisted(() => vi.fn());
vi.mock('@/features/storefront/revalidateSafely', () => ({
  revalidateCatalogSafely,
  revalidateProductSafely: vi.fn(),
}));

function job(over: Partial<ImportJob> = {}): ImportJob {
  return {
    id: ID,
    status: 'completed',
    filename: 'catalogo.csv',
    source_format: 'csv',
    total_rows: 100,
    processed_rows: 100,
    created_count: 80,
    updated_count: 18,
    failed_count: 2,
    categories_created_count: 3,
    error_code: null,
    error_message: null,
    report_truncated: false,
    started_at: '2026-08-23T10:00:00.000Z',
    finished_at: '2026-08-23T10:00:05.000Z',
    created_at: '2026-08-23T10:00:00.000Z',
    errors: [
      {
        row_number: 2,
        sku: 'MAL-1',
        field: 'precio',
        error_code: 'invalid_price',
        error_message: 'mal el precio',
      },
    ],
    pagination: { limit: 50, offset: 0, total: 2 },
    ...over,
  };
}

describe('ImportResult — completado', () => {
  beforeEach(() => {
    revalidateCatalogSafely.mockReset();
  });
  afterEach(() => {
    setEventSink(() => {});
    vi.restoreAllMocks();
  });

  it('muestra los cinco contadores del contrato', () => {
    render(
      <ImportResult job={job()} offset={0} onOffsetChange={vi.fn()} onReiniciar={vi.fn()} />,
    );

    expect(screen.getByText('Productos creados')).toBeInTheDocument();
    expect(screen.getByText('80')).toBeInTheDocument();
    expect(screen.getByText('Productos actualizados')).toBeInTheDocument();
    expect(screen.getByText('18')).toBeInTheDocument();
    expect(screen.getByText('Filas rechazadas')).toBeInTheDocument();
    expect(screen.getByText('Detalle de las filas rechazadas')).toBeInTheDocument();
    expect(screen.getByText('Categorías creadas')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('Filas procesadas')).toBeInTheDocument();
  });

  it('avisa que lo nuevo quedó en BORRADOR y linkea al listado (AC-9)', () => {
    render(
      <ImportResult job={job()} offset={0} onOffsetChange={vi.fn()} onReiniciar={vi.fn()} />,
    );

    // Sin este aviso, el dueño busca sus productos en el storefront y no los
    // encuentra: el import nunca publica.
    expect(screen.getByText(/borrador/i)).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /listado de productos/i }),
    ).toHaveAttribute('href', '/admin/productos');
  });

  it('invalida la caché del catálogo UNA vez, no en cada render', () => {
    const { rerender } = render(
      <ImportResult job={job()} offset={0} onOffsetChange={vi.fn()} onReiniciar={vi.fn()} />,
    );
    expect(revalidateCatalogSafely).toHaveBeenCalledTimes(1);

    // Un re-render (otro poll, un cambio de página de la tabla) no puede disparar
    // una segunda revalidación.
    rerender(
      <ImportResult job={job()} offset={50} onOffsetChange={vi.fn()} onReiniciar={vi.fn()} />,
    );

    expect(revalidateCatalogSafely).toHaveBeenCalledTimes(1);
  });

  it('si la revalidación falla, el resumen se muestra igual', () => {
    revalidateCatalogSafely.mockImplementation(() => {
      throw new Error('no se pudo revalidar');
    });

    // No poder refrescar el storefront es malo, pero perder la pantalla que le
    // dice al dueño qué pasó con su archivo es peor.
    expect(() =>
      render(
        <ImportResult job={job()} offset={0} onOffsetChange={vi.fn()} onReiniciar={vi.fn()} />,
      ),
    ).not.toThrow();
    expect(screen.getByText('Importación terminada')).toBeInTheDocument();
  });

  it('emite import_job_finished una vez, con contadores y duración', () => {
    const eventos: Array<{ event: string; props: Record<string, unknown> }> = [];
    setEventSink((event, props) => eventos.push({ event, props }));

    const { rerender } = render(
      <ImportResult job={job()} offset={0} onOffsetChange={vi.fn()} onReiniciar={vi.fn()} />,
    );
    rerender(
      <ImportResult job={job()} offset={0} onOffsetChange={vi.fn()} onReiniciar={vi.fn()} />,
    );

    const finalizados = eventos.filter((e) => e.event === 'import_job_finished');
    expect(finalizados).toHaveLength(1);
    expect(finalizados[0].props).toMatchObject({
      status: 'completed',
      created: 80,
      updated: 18,
      failed: 2,
      duration_ms: 5_000,
    });
    // Sin el nombre del archivo: es dato del catálogo del cliente.
    expect(JSON.stringify(finalizados[0].props)).not.toContain('catalogo.csv');
  });

  it('mueve el foco al encabezado del resumen', () => {
    render(
      <ImportResult job={job()} offset={0} onOffsetChange={vi.fn()} onReiniciar={vi.fn()} />,
    );

    // Sin esto, quien usa lector de pantalla no se entera de que terminó.
    expect(document.activeElement).toBe(
      screen.getByRole('heading', { name: /importación terminada/i }),
    );
  });

  it('sin filas rechazadas no ofrece descarga', () => {
    render(
      <ImportResult
        job={job({ failed_count: 0, errors: [], pagination: { limit: 50, offset: 0, total: 0 } })}
        offset={0}
        onOffsetChange={vi.fn()}
        onReiniciar={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: /descargar reporte/i })).not.toBeInTheDocument();
  });

  it('un fallo de la descarga se muestra sin perder el resumen', async () => {
    server.use(
      http.get(`${API}/v1/admin/imports/${ID}/report`, () =>
        HttpResponse.json(
          {
            type: 'dsm:import/not-found',
            title: 'Not Found',
            status: 404,
            detail: 'No se encontró esa importación.',
            instance: `/v1/admin/imports/${ID}/report`,
          },
          { status: 404, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );
    render(
      <ImportResult job={job()} offset={0} onOffsetChange={vi.fn()} onReiniciar={vi.fn()} />,
    );

    await userEvent.click(
      screen.getByRole('button', { name: /descargar reporte/i }),
    );

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/no existe|purgó/i),
    );
    expect(screen.getByText('Importación terminada')).toBeInTheDocument();
  });
});

describe('ImportResult — fallido', () => {
  it('un trabajo interrumpido dice qué hacer y NO revalida el catálogo', () => {
    revalidateCatalogSafely.mockReset();
    render(
      <ImportResult
        job={job({
          status: 'failed',
          error_code: 'interrupted',
          error_message: 'El import se interrumpió',
        })}
        offset={0}
        onOffsetChange={vi.fn()}
        onReiniciar={vi.fn()}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(/volvé a subir/i);
    expect(screen.getByRole('alert')).toHaveTextContent(/SKU/);
    // Un trabajo que falló no cambió el catálogo de forma que valga invalidar la
    // caché; hacerlo igual sería un refresh gratis a todo el storefront.
    expect(revalidateCatalogSafely).not.toHaveBeenCalled();
  });

  it('ofrece volver a empezar', async () => {
    const onReiniciar = vi.fn();
    render(
      <ImportResult
        job={job({ status: 'failed', error_code: 'internal', error_message: 'falló' })}
        offset={0}
        onOffsetChange={vi.fn()}
        onReiniciar={onReiniciar}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: /subir otro archivo/i }));
    expect(onReiniciar).toHaveBeenCalled();
  });
});
