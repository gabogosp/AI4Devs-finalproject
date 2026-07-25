import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { AsyncState } from '@/lib/async';
import { CategoriesList } from './CategoriesList';
import type { Category } from './categoriesService';

const cat: Category = {
  id: '1',
  slug: 'refrigeracion',
  name: 'Refrigeración',
  parent_id: null,
  created_at: '2026-01-01T00:00:00.000Z',
};

describe('CategoriesList (4 estados, AC-1)', () => {
  it('loading → skeleton con aria-busy', () => {
    const state: AsyncState<Category[]> = { status: 'loading' };
    render(<CategoriesList state={state} onRetry={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
  });

  it('error → alert con reintento', () => {
    const state: AsyncState<Category[]> = {
      status: 'error',
      error: { kind: 'server', message: 'x' },
    };
    render(<CategoriesList state={state} onRetry={vi.fn()} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Reintentar' }),
    ).toBeInTheDocument();
  });

  it('empty → mensaje accionable', () => {
    const state: AsyncState<Category[]> = { status: 'success', data: [] };
    render(<CategoriesList state={state} onRetry={vi.fn()} />);
    expect(screen.getByText(/Todavía no hay categorías/)).toBeInTheDocument();
  });

  it('success → lista las categorías', () => {
    const state: AsyncState<Category[]> = { status: 'success', data: [cat] };
    render(<CategoriesList state={state} onRetry={vi.fn()} />);
    expect(screen.getByText('Refrigeración')).toBeInTheDocument();
  });
});
