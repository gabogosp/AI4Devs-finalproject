import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { CategoryForm } from './CategoryForm';
import type { Category } from './categoriesService';

const API = 'http://localhost:3000';
const cat: Category = {
  id: '22222222-2222-4222-8222-222222222222',
  slug: 'refrigeracion',
  name: 'Refrigeración',
  parent_id: null,
  created_at: '2026-01-01T00:00:00.000Z',
};

afterEach(() => vi.clearAllMocks());

describe('CategoryForm (AC-1)', () => {
  it('validación cliente: nombre vacío → error, no submitea', async () => {
    const onSaved = vi.fn();
    render(<CategoryForm onSaved={onSaved} />);
    await userEvent.click(screen.getByRole('button', { name: 'Crear' }));
    expect(await screen.findByText('El nombre es requerido')).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('alta OK → onSaved con la categoría', async () => {
    server.use(
      http.post(`${API}/v1/admin/categories`, () =>
        HttpResponse.json(cat, { status: 201 }),
      ),
    );
    const onSaved = vi.fn();
    render(<CategoryForm onSaved={onSaved} />);
    await userEvent.type(screen.getByLabelText(/Nombre/), 'Refrigeración');
    await userEvent.click(screen.getByRole('button', { name: 'Crear' }));
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledWith(cat));
  });

  it('slug duplicado (409) → banner, sin llamar onSaved', async () => {
    server.use(
      http.post(`${API}/v1/admin/categories`, () =>
        HttpResponse.json(
          { type: 'dsm:catalog/conflict', status: 409, detail: 'dup' },
          { status: 409 },
        ),
      ),
    );
    const onSaved = vi.fn();
    render(<CategoryForm onSaved={onSaved} />);
    await userEvent.type(screen.getByLabelText(/Nombre/), 'Ferretería');
    await userEvent.click(screen.getByRole('button', { name: 'Crear' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Ya existe/);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('edición → PATCH y onSaved', async () => {
    server.use(
      http.patch(`${API}/v1/admin/categories/${cat.id}`, () =>
        HttpResponse.json({ ...cat, name: 'Refrigeración y Aire' }),
      ),
    );
    const onSaved = vi.fn();
    render(<CategoryForm initial={cat} onSaved={onSaved} />);
    const input = screen.getByLabelText(/Nombre/);
    await userEvent.clear(input);
    await userEvent.type(input, 'Refrigeración y Aire');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalled());
  });
});
