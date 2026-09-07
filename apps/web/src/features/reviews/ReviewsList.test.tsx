import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReviewsList } from './ReviewsList';
import type { ReviewViewModel } from './types';

function review(overrides: Partial<ReviewViewModel> = {}): ReviewViewModel {
  return {
    id: 'r1',
    authorName: 'Ana Gómez',
    rating: 4,
    comment: 'Excelente producto, llegó rápido.',
    createdAt: '2026-08-30T10:00:00.000Z',
    isOwn: false,
    hidden: false,
    ...overrides,
  };
}

describe('ReviewsList (T-A8)', () => {
  it('renderiza una <ul> con un <li> por reseña', () => {
    render(<ReviewsList reviews={[review({ id: 'r1' }), review({ id: 'r2' })]} />);
    expect(screen.getByRole('list')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('con lista vacía no renderiza ningún <ul> (delega el caso a ReviewsSummary)', () => {
    const { container } = render(<ReviewsList reviews={[]} />);
    expect(container.querySelector('ul')).toBeNull();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('sin onToggleHidden ninguna fila muestra botón de moderación', () => {
    render(<ReviewsList reviews={[review({ id: 'r1' }), review({ id: 'r2' })]} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('con onToggleHidden cada fila muestra su propio botón (T-B10)', () => {
    render(
      <ReviewsList
        reviews={[review({ id: 'r1', hidden: false }), review({ id: 'r2', hidden: true })]}
        onToggleHidden={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Ocultar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mostrar de nuevo' })).toBeInTheDocument();
  });
});
