import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OrderStatusHistory } from './OrderStatusHistory';
import type { AdminOrderStatusChange } from '@/api/generated/model';

describe('OrderStatusHistory (T7.1, AC-9)', () => {
  const ENTRIES: AdminOrderStatusChange[] = [
    { from_status: null, to_status: 'new', changed_by: null, changed_at: '2026-08-30T10:00:00.000Z' },
    { from_status: 'new', to_status: 'preparing', changed_by: 'admin', changed_at: '2026-08-30T10:05:00.000Z' },
    {
      from_status: 'preparing',
      to_status: 'ready',
      changed_by: '11111111-1111-1111-1111-111111111111',
      changed_at: '2026-08-30T10:10:00.000Z',
    },
  ];

  it('renderiza una fila por entrada, en orden, con AMBOS estados por fila', () => {
    render(<OrderStatusHistory entries={ENTRIES} />);

    const filas = screen.getAllByRole('listitem');
    expect(filas).toHaveLength(3);

    expect(filas[0]).toHaveTextContent('— → Nueva');
    expect(filas[1]).toHaveTextContent('Nueva → Preparando');
    expect(filas[1]).toHaveTextContent('cambiado por admin');
    expect(filas[2]).toHaveTextContent('Preparando → Lista para retirar');
    expect(filas[2]).toHaveTextContent('cambiado por 11111111-1111-1111-1111-111111111111');
  });

  it('el primer registro (from_status: null) se muestra como "— → Nueva"', () => {
    render(<OrderStatusHistory entries={[ENTRIES[0]]} />);
    expect(screen.getByRole('listitem')).toHaveTextContent('— → Nueva');
  });

  it('changed_by null no deja un placeholder vacío', () => {
    render(<OrderStatusHistory entries={[ENTRIES[0]]} />);
    expect(screen.getByRole('listitem')).not.toHaveTextContent('cambiado por');
  });
});
