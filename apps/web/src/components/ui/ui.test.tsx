import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from './Button';
import { Field, Input } from './Field';

describe('Button', () => {
  it('renderiza y dispara onClick', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Guardar</Button>);
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('loading marca aria-busy y deshabilita', () => {
    render(<Button loading>Guardar</Button>);
    const btn = screen.getByRole('button', { name: /Guardar/ });
    expect(btn).toHaveAttribute('aria-busy', 'true');
    expect(btn).toBeDisabled();
  });

  it('variante destructive expone el rol de botón', () => {
    render(<Button variant="destructive">Archivar</Button>);
    expect(screen.getByRole('button', { name: 'Archivar' })).toBeInTheDocument();
  });
});

describe('Field + Input', () => {
  it('asocia label al input y expone el error vía aria-describedby', () => {
    render(
      <Field label="SKU" error="SKU duplicado" required>
        {({ inputId, describedBy }) => (
          <Input id={inputId} aria-describedby={describedBy} invalid />
        )}
      </Field>,
    );
    const input = screen.getByLabelText(/SKU/);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    const describedBy = input.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(screen.getByRole('alert')).toHaveTextContent('SKU duplicado');
  });

  it('sin error no marca aria-invalid', () => {
    render(
      <Field label="Nombre">
        {({ inputId, describedBy }) => (
          <Input id={inputId} aria-describedby={describedBy} />
        )}
      </Field>,
    );
    expect(screen.getByLabelText('Nombre')).not.toHaveAttribute('aria-invalid');
  });
});
