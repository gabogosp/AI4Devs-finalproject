import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

  describe('acción de moderación admin (T-B10, design.md §D8)', () => {
    it('sin onToggleHidden no renderiza ningún botón de moderación (sin regresión en storefront)', () => {
      render(<ReviewListItem review={review()} />);
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('con onToggleHidden y hidden=false muestra el botón "Ocultar"', () => {
      render(<ReviewListItem review={review({ hidden: false })} onToggleHidden={vi.fn()} />);
      expect(screen.getByRole('button', { name: 'Ocultar' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Mostrar de nuevo' })).not.toBeInTheDocument();
    });

    it('con onToggleHidden y hidden=true muestra el botón "Mostrar de nuevo"', () => {
      render(<ReviewListItem review={review({ hidden: true })} onToggleHidden={vi.fn()} />);
      expect(screen.getByRole('button', { name: 'Mostrar de nuevo' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Ocultar' })).not.toBeInTheDocument();
    });

    it('muestra el texto "Oculta por moderación" cuando hidden=true, aunque isOwn sea false', () => {
      render(<ReviewListItem review={review({ isOwn: false, hidden: true })} onToggleHidden={vi.fn()} />);
      expect(screen.getByText('Oculta por moderación')).toBeInTheDocument();
    });

    it('clickear "Ocultar" llama a onToggleHidden(id, true)', async () => {
      const user = userEvent.setup();
      const onToggleHidden = vi.fn();
      render(
        <ReviewListItem review={review({ id: 'r1', hidden: false })} onToggleHidden={onToggleHidden} />,
      );

      await user.click(screen.getByRole('button', { name: 'Ocultar' }));

      expect(onToggleHidden).toHaveBeenCalledWith('r1', true);
    });

    it('clickear "Mostrar de nuevo" llama a onToggleHidden(id, false)', async () => {
      const user = userEvent.setup();
      const onToggleHidden = vi.fn();
      render(
        <ReviewListItem review={review({ id: 'r1', hidden: true })} onToggleHidden={onToggleHidden} />,
      );

      await user.click(screen.getByRole('button', { name: 'Mostrar de nuevo' }));

      expect(onToggleHidden).toHaveBeenCalledWith('r1', false);
    });
  });
});
