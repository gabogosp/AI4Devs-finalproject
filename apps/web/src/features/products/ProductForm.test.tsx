import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { ProductForm } from './ProductForm';
import type { Product } from './productsService';
import type { Category } from '@/features/categories/categoriesService';

const API = 'http://localhost:3000';
const CAT_ID = '22222222-2222-4222-8222-222222222222';
const categories: Category[] = [
  { id: CAT_ID, slug: 'refrigeracion', name: 'Refrigeración', parent_id: null, created_at: '2026-01-01T00:00:00.000Z' },
];

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
    category_id: CAT_ID,
    image_url: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

async function fillValid(): Promise<void> {
  await userEvent.type(screen.getByLabelText(/SKU/), 'REF-001');
  await userEvent.type(screen.getByLabelText(/Nombre/), 'Heladera');
  await userEvent.type(screen.getByLabelText(/Precio/), '1000');
  await userEvent.clear(screen.getByLabelText(/Stock/));
  await userEvent.type(screen.getByLabelText(/Stock/), '5');
  await userEvent.selectOptions(screen.getByLabelText(/Categoría/), CAT_ID);
}

afterEach(() => vi.clearAllMocks());

describe('ProductForm (AC-2/AC-3/AC-5/AC-9)', () => {
  it('validación cliente (AC-5): precio 0 y nombre vacío → errores, no submitea', async () => {
    const onSaved = vi.fn();
    render(<ProductForm categories={categories} onSaved={onSaved} />);
    await userEvent.type(screen.getByLabelText(/SKU/), 'X');
    await userEvent.type(screen.getByLabelText(/Precio/), '0');
    await userEvent.click(screen.getByRole('button', { name: /Crear/ }));
    expect(await screen.findByText('El nombre es requerido')).toBeInTheDocument();
    expect(screen.getByText('El precio debe ser mayor a 0')).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('alta OK (AC-2): convierte pesos→centavos y llama onSaved', async () => {
    let body: Record<string, unknown> = {};
    server.use(
      http.post(`${API}/v1/admin/products`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(product({ status: 'draft' }), { status: 201 });
      }),
    );
    const onSaved = vi.fn();
    render(<ProductForm categories={categories} onSaved={onSaved} />);
    await fillValid();
    await userEvent.click(screen.getByRole('button', { name: /Crear/ }));
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(body.price_ars_cents).toBe(100000); // 1000 pesos → 100000 centavos
    expect(body.status).toBeUndefined(); // el estado inicial lo fija el backend
  });

  it('SKU duplicado (AC-9): 409 → banner y error bajo el campo sku, sin onSaved', async () => {
    server.use(
      http.post(`${API}/v1/admin/products`, () =>
        HttpResponse.json(
          { type: 'dsm:catalog/conflict', status: 409, detail: 'SKU duplicado' },
          { status: 409 },
        ),
      ),
    );
    const onSaved = vi.fn();
    render(<ProductForm categories={categories} onSaved={onSaved} />);
    await fillValid();
    await userEvent.click(screen.getByRole('button', { name: /Crear/ }));
    const alerts = await screen.findAllByRole('alert');
    expect(alerts.some((a) => /SKU/.test(a.textContent ?? ''))).toBe(true);
    expect(
      screen.getAllByText(/Ya existe un producto con ese SKU/).length,
    ).toBeGreaterThan(0);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('422 por campo (AC-5): mapea errors[] a los campos, preserva input', async () => {
    server.use(
      http.post(`${API}/v1/admin/products`, () =>
        HttpResponse.json(
          {
            type: 'dsm:catalog/validation',
            status: 422,
            detail: 'inválido',
            errors: [
              { field: 'price_ars_cents', message: 'requerido y > 0' },
              { field: 'stock', message: 'no puede ser negativo' },
            ],
          },
          { status: 422 },
        ),
      ),
    );
    render(<ProductForm categories={categories} onSaved={vi.fn()} />);
    await fillValid();
    await userEvent.click(screen.getByRole('button', { name: /Crear/ }));
    expect(await screen.findByText('requerido y > 0')).toBeInTheDocument();
    expect(screen.getByText('no puede ser negativo')).toBeInTheDocument();
    // input preservado
    expect(screen.getByLabelText(/Nombre/)).toHaveValue('Heladera');
  });

  it('edición (AC-3): precarga, no envía sku, muestra $ con IVA', async () => {
    let body: Record<string, unknown> = {};
    server.use(
      http.patch(`${API}/v1/admin/products/11111111-1111-4111-8111-111111111111`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(product({ price_ars_cents: 250000 }));
      }),
    );
    const onSaved = vi.fn();
    render(<ProductForm categories={categories} initial={product()} onSaved={onSaved} />);
    expect(screen.getByLabelText(/SKU/)).toBeDisabled();
    expect(screen.getByText(/Precio actual/)).toHaveTextContent(/IVA incluido/);
    const price = screen.getByLabelText(/Precio/);
    await userEvent.clear(price);
    await userEvent.type(price, '2500');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(body.sku).toBeUndefined();
    expect(body.price_ars_cents).toBe(250000);
  });
});
