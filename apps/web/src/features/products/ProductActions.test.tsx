import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { ProductActions } from './ProductActions';
import type { Product } from './productsService';

const API = 'http://localhost:3000';

function product(over: Partial<Product> = {}): Product {
  return {
    id: '11111111-1111-4111-8111-111111111111',
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

describe('ProductActions — publicar (AC-4/AC-6)', () => {
  it('publica un draft completo → status published', async () => {
    server.use(
      http.patch(`${API}/v1/admin/products/11111111-1111-4111-8111-111111111111`, () =>
        HttpResponse.json(product({ status: 'published' })),
      ),
    );
    render(<ProductActions product={product()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Publicar' }));
    expect(await screen.findByTestId('product-status')).toHaveTextContent(
      'published',
    );
  });

  it('publicar incompleto (422) → muestra qué falta y PERMANECE draft (AC-6)', async () => {
    server.use(
      http.patch(`${API}/v1/admin/products/11111111-1111-4111-8111-111111111111`, () =>
        HttpResponse.json(
          {
            type: 'dsm:catalog/invalid-transition',
            status: 422,
            detail: 'incompleto',
            errors: [{ field: 'category_id', message: 'requerida' }],
          },
          { status: 422 },
        ),
      ),
    );
    render(<ProductActions product={product()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Publicar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/categoría/);
    expect(screen.getByTestId('product-status')).toHaveTextContent('draft');
  });
});

describe('ProductActions — archivar (AC-7, confirmación 2 pasos)', () => {
  it('exige escribir ARCHIVAR antes de confirmar; luego archiva', async () => {
    server.use(
      http.patch(`${API}/v1/admin/products/11111111-1111-4111-8111-111111111111`, () =>
        HttpResponse.json(product({ status: 'archived' })),
      ),
    );
    render(<ProductActions product={product()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Archivar' }));

    const dialog = screen.getByRole('dialog');
    const confirmBtn = within(dialog).getByRole('button', { name: 'Archivar' });
    // deshabilitado hasta escribir la palabra
    expect(confirmBtn).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText(/ARCHIVAR/), 'ARCHIVAR');
    expect(confirmBtn).toBeEnabled();
    await userEvent.click(confirmBtn);

    expect(await screen.findByTestId('product-status')).toHaveTextContent(
      'archived',
    );
    expect(dialog).not.toBeInTheDocument();
  });

  it('Cancelar cierra sin archivar', async () => {
    render(<ProductActions product={product()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Archivar' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('product-status')).toHaveTextContent('draft');
  });
});
