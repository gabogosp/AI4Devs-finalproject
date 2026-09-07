import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StarRatingInput } from './StarRatingInput';

describe('StarRatingInput (T-A3)', () => {
  it('renderiza 5 controles role=radio con aria-label "N de 5 estrellas" dentro de un radiogroup', () => {
    render(<StarRatingInput value={0} onChange={() => {}} />);
    expect(screen.getByRole('radiogroup', { name: 'Calificación' })).toBeInTheDocument();
    for (let n = 1; n <= 5; n += 1) {
      expect(screen.getByRole('radio', { name: `${n} de 5 estrellas` })).toBeInTheDocument();
    }
  });

  it('llama a onChange con el valor clickeado', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<StarRatingInput value={0} onChange={onChange} />);
    await user.click(screen.getByRole('radio', { name: '4 de 5 estrellas' }));
    expect(onChange).toHaveBeenCalledWith(4);
  });

  it('marca aria-checked=true sólo en la estrella seleccionada', () => {
    render(<StarRatingInput value={3} onChange={() => {}} />);
    expect(screen.getByRole('radio', { name: '3 de 5 estrellas' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('radio', { name: '1 de 5 estrellas' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  it('navega con flechas dentro del grupo y selecciona con Enter/Space', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<StarRatingInput value={0} onChange={onChange} />);

    await user.tab();
    expect(screen.getByRole('radio', { name: '1 de 5 estrellas' })).toHaveFocus();

    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(screen.getByRole('radio', { name: '3 de 5 estrellas' })).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledWith(3);

    onChange.mockClear();
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('radio', { name: '2 de 5 estrellas' })).toHaveFocus();

    await user.keyboard(' ');
    expect(onChange).toHaveBeenCalledWith(2);
  });

  it('no existe ningún camino de la UI para producir un valor fuera de 1-5 (wrap-around en los extremos)', async () => {
    const user = userEvent.setup();
    render(<StarRatingInput value={0} onChange={() => {}} />);

    await user.tab();
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('radio', { name: '5 de 5 estrellas' })).toHaveFocus();

    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: '1 de 5 estrellas' })).toHaveFocus();
  });

  it('con disabled=true no llama a onChange al clickear', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<StarRatingInput value={0} onChange={onChange} disabled />);
    await user.click(screen.getByRole('radio', { name: '4 de 5 estrellas' }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
