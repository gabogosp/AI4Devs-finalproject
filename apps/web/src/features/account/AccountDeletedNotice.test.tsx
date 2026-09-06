import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AccountDeletedNotice } from './AccountDeletedNotice';

/**
 * US-020 AC-2/AC-11: pantalla de confirmación post-borrado. `role="status"`
 * `aria-live="polite"` (confirmación, no interrupción) y foco al propio
 * `<h2 tabIndex={-1}>` al montar (design-system §11 — foco gestionado al
 * cambiar de contenido).
 */
describe('AccountDeletedNotice', () => {
  it('al montar, el foco queda en el heading', async () => {
    render(<AccountDeletedNotice />);

    await waitFor(() =>
      expect(screen.getByRole('heading')).toHaveFocus(),
    );
  });

  it('es role="status" aria-live="polite" (confirmación, no interrupción)', () => {
    render(<AccountDeletedNotice />);

    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
  });

  it('menciona explícitamente que es irreversible, que el email queda libre, y que el historial se conserva anonimizado', () => {
    render(<AccountDeletedNotice />);

    expect(screen.getByText(/no se puede deshacer|irreversible/i)).toBeInTheDocument();
    expect(screen.getByText(/email.*libre|volver a registrarte/i)).toBeInTheDocument();
    expect(screen.getByText(/historial.*conserva|conserva.*historial/i)).toBeInTheDocument();
  });

  it('no renderiza ningún dato personal del cliente (AC-2, superficie)', () => {
    render(<AccountDeletedNotice />);

    expect(screen.queryByText(/@/)).not.toBeInTheDocument();
  });

  it('ofrece un link para volver al inicio', () => {
    render(<AccountDeletedNotice />);

    expect(screen.getByRole('link', { name: /volver al inicio/i })).toHaveAttribute('href', '/');
  });
});
