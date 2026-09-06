import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AsyncState } from '@/lib/async';
import { ReviewForm, type ReviewFormProps } from './ReviewForm';

function renderForm(overrides: Partial<ReviewFormProps> = {}) {
  const onSubmit = vi.fn();
  const submitState: AsyncState<void> = { status: 'idle' };
  render(<ReviewForm onSubmit={onSubmit} submitState={submitState} {...overrides} />);
  return { onSubmit };
}

describe('ReviewForm (T-A7, AC-2/AC-5/AC-9)', () => {
  it("AC-2: enviar con rating seleccionado y sin comentario llama a onSubmit con comment: ''", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderForm();

    await user.click(screen.getByRole('radio', { name: '3 de 5 estrellas' }));
    await user.click(screen.getByRole('button', { name: /publicar reseña/i }));

    expect(onSubmit).toHaveBeenCalledWith({ rating: 3, comment: '' });
  });

  it('sin ningún rating seleccionado el submit está deshabilitado', () => {
    renderForm();
    expect(screen.getByRole('button', { name: /publicar reseña/i })).toBeDisabled();
  });

  it('AC-5: con initialValue arranca precargado (modo edición)', () => {
    renderForm({ initialValue: { rating: 4, comment: 'Muy bueno' } });

    expect(screen.getByRole('radio', { name: '4 de 5 estrellas' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByLabelText(/comentario/i)).toHaveValue('Muy bueno');
    expect(screen.getByRole('button', { name: /guardar cambios/i })).toBeEnabled();
  });

  it('AC-9: con fieldError de comment lo asocia vía aria-describedby', () => {
    renderForm({ fieldError: { field: 'comment', message: 'Comentario demasiado largo' } });

    const textarea = screen.getByLabelText(/comentario/i);
    const describedBy = textarea.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy as string)).toHaveTextContent(
      'Comentario demasiado largo',
    );
  });

  it('AC-9: con fieldError de rating muestra el mensaje junto al selector', () => {
    renderForm({ fieldError: { field: 'rating', message: 'Calificación inválida' } });
    expect(screen.getByRole('alert')).toHaveTextContent('Calificación inválida');
  });

  it('durante submitState "loading" el botón de envío tiene aria-busy y está deshabilitado', () => {
    renderForm({ initialValue: { rating: 5, comment: '' }, submitState: { status: 'loading' } });
    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toBeDisabled();
  });
});
