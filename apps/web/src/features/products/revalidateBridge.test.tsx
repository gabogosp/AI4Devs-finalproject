import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import type { Product } from './productsService';

/**
 * El puente panel → storefront (AC-9): una mutación **exitosa** invalida la
 * ficha pública; una fallida NO. Invalidar tras un fallo tiraría caché buena y,
 * peor, sugeriría que el cambio se aplicó.
 */
const revalidateProductSafely = vi.fn();
vi.mock('@/features/storefront/revalidateSafely', () => ({
  revalidateProductSafely: (slug: string) => revalidateProductSafely(slug),
}));

const { ProductActions } = await import('./ProductActions');

const API = 'http://localhost:3000';
const ID = '11111111-1111-4111-8111-111111111111';

function product(over: Partial<Product> = {}): Product {
  return {
    id: ID,
    sku: 'REF-001',
    slug: 'heladera',
    name: 'Heladera',
    description_raw: null,
    price_ars_cents: 100000,
    stock: 5,
    status: 'draft',
    category_id: '22222222-2222-4222-8222-222222222222',
    image_url: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

describe('puente de invalidación tras mutar en el panel', () => {
  beforeEach(() => revalidateProductSafely.mockClear());

  it('publicar OK invalida la ficha exactamente una vez, con su slug', async () => {
    server.use(
      http.patch(`${API}/v1/admin/products/${ID}`, () =>
        HttpResponse.json(product({ status: 'published' })),
      ),
    );
    render(<ProductActions product={product()} />);

    await userEvent.click(screen.getByRole('button', { name: 'Publicar' }));
    await screen.findByText('Producto publicado.');

    expect(revalidateProductSafely).toHaveBeenCalledTimes(1);
    expect(revalidateProductSafely).toHaveBeenCalledWith('heladera');
  });

  it('publicar que falla con 422 NO invalida nada', async () => {
    server.use(
      http.patch(`${API}/v1/admin/products/${ID}`, () =>
        HttpResponse.json(
          {
            type: 'dsm:catalog/validation',
            status: 422,
            detail: 'Faltan datos',
            errors: [{ field: 'price_ars_cents', message: 'requerido' }],
          },
          { status: 422 },
        ),
      ),
    );
    render(<ProductActions product={product()} />);

    await userEvent.click(screen.getByRole('button', { name: 'Publicar' }));
    await screen.findByRole('alert');

    expect(revalidateProductSafely).not.toHaveBeenCalled();
  });

  it('archivar OK invalida la ficha (deja de ser accesible públicamente)', async () => {
    server.use(
      http.patch(`${API}/v1/admin/products/${ID}`, () =>
        HttpResponse.json(product({ status: 'archived' })),
      ),
    );
    render(<ProductActions product={product({ status: 'published' })} />);

    await userEvent.click(screen.getByRole('button', { name: 'Archivar' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/ARCHIVAR/), 'ARCHIVAR');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Archivar' }));
    await screen.findByText('Producto archivado.');

    expect(revalidateProductSafely).toHaveBeenCalledWith('heladera');
  });
});
