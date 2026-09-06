import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RangeFilterForm } from './RangeFilterForm';

describe('RangeFilterForm', () => {
  it('invoca onApply con el rango cuando from <= to', () => {
    const onApply = vi.fn();
    render(<RangeFilterForm appliedRange={{}} onApply={onApply} />);

    fireEvent.change(screen.getByLabelText('Desde'), {
      target: { value: '2026-08-01' },
    });
    fireEvent.change(screen.getByLabelText('Hasta'), {
      target: { value: '2026-08-31' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar' }));

    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith({ from: '2026-08-01', to: '2026-08-31' });
  });

  it('nunca invoca onApply con from > to: deshabilita Aplicar y muestra el mensaje', () => {
    const onApply = vi.fn();
    render(<RangeFilterForm appliedRange={{}} onApply={onApply} />);

    fireEvent.change(screen.getByLabelText('Desde'), {
      target: { value: '2026-09-01' },
    });
    fireEvent.change(screen.getByLabelText('Hasta'), {
      target: { value: '2026-08-01' },
    });

    const boton = screen.getByRole('button', { name: 'Aplicar' });
    expect(boton).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'no puede ser posterior',
    );

    fireEvent.click(boton);
    expect(onApply).not.toHaveBeenCalled();
  });

  it('sin tocar el rango, Aplicar manda ambos extremos undefined', () => {
    const onApply = vi.fn();
    render(<RangeFilterForm appliedRange={{}} onApply={onApply} />);

    fireEvent.click(screen.getByRole('button', { name: 'Aplicar' }));

    expect(onApply).toHaveBeenCalledWith({ from: undefined, to: undefined });
  });
});
