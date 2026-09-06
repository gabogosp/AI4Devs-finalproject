import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReviewsSummary } from './ReviewsSummary';

describe('ReviewsSummary (T-A5, AC-3/AC-4)', () => {
  it('con count > 0 muestra el promedio a 1 decimal y "{count} reseñas" (AC-3)', () => {
    render(<ReviewsSummary summary={{ average: 4.5, count: 12 }} />);
    expect(screen.getByLabelText('Calificación promedio: 4.5 de 5')).toBeInTheDocument();
    expect(screen.getByText('12 reseñas')).toBeInTheDocument();
  });

  it('formatea un promedio entero a 1 decimal ("4.0")', () => {
    render(<ReviewsSummary summary={{ average: 4, count: 3 }} />);
    expect(screen.getByText('4.0')).toBeInTheDocument();
  });

  it('con count === 0 muestra "Sin reseñas todavía" y no muestra promedio ni "0 reseñas" (AC-4)', () => {
    render(<ReviewsSummary summary={{ average: 0, count: 0 }} />);
    expect(screen.getByText('Sin reseñas todavía')).toBeInTheDocument();
    expect(screen.queryByText('0 reseñas')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Calificación promedio/)).not.toBeInTheDocument();
  });
});
