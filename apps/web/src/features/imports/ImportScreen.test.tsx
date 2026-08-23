import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '@/test/server';
import { ImportScreen } from './ImportScreen';
import type { ImportJob } from './importsService';

const API = 'http://localhost:3000';
const ID = '2f1c9a4e-1111-4111-8111-111111111111';

const push = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('@/features/storefront/revalidateSafely', () => ({
  revalidateCatalogSafely: vi.fn(),
  revalidateProductSafely: vi.fn(),
}));

function job(over: Partial<ImportJob> = {}): ImportJob {
  return {
    id: ID,
    status: 'running',
    filename: 'catalogo.csv',
    source_format: 'csv',
    total_rows: null,
    processed_rows: 40,
    created_count: 40,
    updated_count: 0,
    failed_count: 0,
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

describe('ImportScreen — entrada sin trabajo', () => {
  beforeEach(() => {
    push.mockReset();
    sessionStorage.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('muestra el selector de archivo', () => {
    render(<ImportScreen />);
    expect(screen.getByLabelText(/archivo del catálogo/i)).toBeInTheDocument();
  });

  it('con un id reciente en sessionStorage ofrece retomar ese trabajo', async () => {
    sessionStorage.setItem('dsm:ultimo-import', ID);
    render(<ImportScreen />);

    const boton = await screen.findByRole('button', { name: /ver su resultado/i });
    await userEvent.click(boton);

    expect(push).toHaveBeenCalledWith(`/admin/importar/${ID}`);
  });

  it('tras crear el trabajo navega al deep-link y guarda el id', async () => {
    server.use(
      http.post(`${API}/v1/admin/imports`, () =>
        HttpResponse.json({ id: ID, status: 'pending' }, { status: 202 }),
      ),
    );
    render(<ImportScreen />);

    await userEvent.upload(
      screen.getByLabelText(/archivo del catálogo/i),
      new File(['sku,nombre\n'], 'catalogo.csv', { type: 'text/csv' }),
    );
    await userEvent.click(screen.getByRole('button', { name: /importar catálogo/i }));

    // La URL es lo que hace que un refresh no pierda de vista el trabajo (OQ-FE-3).
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/admin/importar/${ID}`));
    expect(sessionStorage.getItem('dsm:ultimo-import')).toBe(ID);
  });
});

describe('ImportScreen — siguiendo un trabajo por su id', () => {
  beforeEach(() => {
    push.mockReset();
    sessionStorage.clear();
  });

  it('un trabajo en curso muestra el progreso', async () => {
    server.use(
      http.get(`${API}/v1/admin/imports/${ID}`, () => HttpResponse.json(job())),
    );
    render(<ImportScreen jobId={ID} />);

    await waitFor(() => expect(screen.getByRole('progressbar')).toBeInTheDocument());
    expect(screen.getByRole('status')).toHaveTextContent(/40 filas leídas/);
  });

  it('un trabajo terminado muestra el resultado', async () => {
    server.use(
      http.get(`${API}/v1/admin/imports/${ID}`, () =>
        HttpResponse.json(
          job({
            status: 'completed',
            total_rows: 40,
            processed_rows: 40,
            finished_at: '2026-08-23T10:00:05.000Z',
          }),
        ),
      ),
    );
    render(<ImportScreen jobId={ID} />);

    expect(
      await screen.findByRole('heading', { name: /importación terminada/i }),
    ).toBeInTheDocument();
  });

  it('un id inexistente lo dice y ofrece empezar de nuevo', async () => {
    server.use(
      http.get(`${API}/v1/admin/imports/${ID}`, () =>
        HttpResponse.json(
          {
            type: 'dsm:import/not-found',
            title: 'Not Found',
            status: 404,
            detail: 'No se encontró esa importación.',
            instance: `/v1/admin/imports/${ID}`,
          },
          { status: 404, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );
    render(<ImportScreen jobId={ID} />);

    const aviso = await screen.findByRole('alert');
    expect(aviso).toHaveTextContent(/no existe|purgó/i);
    // El dato que evita que el dueño crea que se perdió su trabajo.
    expect(aviso).toHaveTextContent(/90 días/);

    await userEvent.click(screen.getByRole('button', { name: /importar un archivo/i }));
    expect(push).toHaveBeenCalledWith('/admin/importar');
  });

  it('un fallo de red no dice que el trabajo se perdió', async () => {
    server.use(
      http.get(`${API}/v1/admin/imports/${ID}`, () => HttpResponse.error()),
    );
    render(<ImportScreen jobId={ID} />);

    const aviso = await screen.findByRole('alert');
    // El trabajo corre en el servidor: la pantalla no puede sugerir lo contrario.
    expect(aviso).toHaveTextContent(/sigue corriendo/i);
  });

  it('«importar otro archivo» limpia el respaldo y vuelve al selector', async () => {
    sessionStorage.setItem('dsm:ultimo-import', ID);
    server.use(
      http.get(`${API}/v1/admin/imports/${ID}`, () =>
        HttpResponse.json(
          job({ status: 'completed', total_rows: 40, finished_at: '2026-08-23T10:00:05.000Z' }),
        ),
      ),
    );
    render(<ImportScreen jobId={ID} />);
    await screen.findByRole('heading', { name: /importación terminada/i });

    await userEvent.click(screen.getByRole('button', { name: /importar otro archivo/i }));

    expect(sessionStorage.getItem('dsm:ultimo-import')).toBeNull();
    expect(push).toHaveBeenCalledWith('/admin/importar');
  });
});
