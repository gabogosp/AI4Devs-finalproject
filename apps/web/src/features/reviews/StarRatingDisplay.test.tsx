import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StarRatingDisplay } from './StarRatingDisplay';

describe('StarRatingDisplay (T-A4)', () => {
  it('modo "average" anuncia "Calificación promedio: {n} de 5"', () => {
    render(<StarRatingDisplay value={4.5} mode="average" />);
    expect(screen.getByLabelText('Calificación promedio: 4.5 de 5')).toBeInTheDocument();
  });

  it('modo "item" anuncia "{n} de 5 estrellas"', () => {
    render(<StarRatingDisplay value={3} mode="item" />);
    expect(screen.getByLabelText('3 de 5 estrellas')).toBeInTheDocument();
  });

  it('no expone ningún rol interactivo (radio/button) en modo "average"', () => {
    render(<StarRatingDisplay value={4.5} mode="average" />);
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('no expone ningún rol interactivo (radio/button) en modo "item"', () => {
    render(<StarRatingDisplay value={3} mode="item" />);
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});
