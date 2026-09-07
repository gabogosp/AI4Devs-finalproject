import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReviewsList } from './ReviewsList';
import { ReviewListItem } from './ReviewListItem';
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

describe('ReviewListItem (T-A8, AC-8)', () => {
  it('muestra StarRatingDisplay modo item, autor, comentario como texto plano y fecha', () => {
    render(<ReviewListItem review={review()} />);

    expect(screen.getByLabelText('4 de 5 estrellas')).toBeInTheDocument();
    expect(screen.getByText('Ana Gómez')).toBeInTheDocument();
    expect(screen.getByText('Excelente producto, llegó rápido.')).toBeInTheDocument();
  });

  it('nunca interpreta el comentario como HTML (sin dangerouslySetInnerHTML)', () => {
    const { container } = render(
      <ReviewListItem review={review({ comment: '<script>alert(1)</script>' })} />,
    );

    expect(screen.getByText('<script>alert(1)</script>')).toBeInTheDocument();
    expect(container.querySelector('script')).toBeNull();
  });

  it('cuando isOwn && hidden muestra el texto "Oculta por moderación" (AC-8)', () => {
    render(<ReviewListItem review={review({ isOwn: true, hidden: true })} />);
    expect(screen.getByText('Oculta por moderación')).toBeInTheDocument();
  });

  it('cuando isOwn pero NO hidden no muestra el badge de moderación', () => {
    render(<ReviewListItem review={review({ isOwn: true, hidden: false })} />);
    expect(screen.queryByText('Oculta por moderación')).not.toBeInTheDocument();
  });

  it('cuando hidden pero NO isOwn (reseña ajena) no muestra el badge', () => {
    render(<ReviewListItem review={review({ isOwn: false, hidden: true })} />);
    expect(screen.queryByText('Oculta por moderación')).not.toBeInTheDocument();
  });
});

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
});
