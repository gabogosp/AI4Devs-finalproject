import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe, toHaveNoViolations } from 'jest-axe';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CheckoutCreated } from './checkoutService';
import { CheckoutBlocked } from './CheckoutBlocked';
import { CheckoutConfirmation } from './CheckoutConfirmation';
import { CheckoutForm } from './CheckoutForm';

// Ningún test de este archivo dispara un submit real (la validación con
// errores visibles es 100% cliente) — mockeado sólo para que CheckoutForm
// (vía useCheckout) no intente una llamada de red real al montar/enviar.
vi.mock('./checkoutService', () => ({
  checkoutService: { submit: vi.fn() },
}));

expect.extend(toHaveNoViolations);

afterEach(() => vi.clearAllMocks());

const orden: CheckoutCreated = {
  order_token: 'a'.repeat(64),
  order_number: 1000,
  status: 'pending_payment',
  total_ars_cents: 640000,
  items_count: 1,
};

describe('a11y — checkout (WCAG 2.1 AA)', () => {
  it('CheckoutBlocked: axe sin violaciones, un solo h1', async () => {
    const { container } = render(<CheckoutBlocked reason="empty" />);

    expect(await axe(container)).toHaveNoViolations();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('CheckoutForm sin errores: axe sin violaciones', async () => {
    const { container } = render(<CheckoutForm onSuccess={vi.fn()} />);

    expect(await axe(container)).toHaveNoViolations();
  });

  it('CheckoutForm con errores visibles: axe sin violaciones', async () => {
    const { container } = render(<CheckoutForm onSuccess={vi.fn()} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /confirmar pedido/i }));
    await screen.findByText(/ingresá tu nombre/i);

    expect(await axe(container)).toHaveNoViolations();
  });

  it('CheckoutConfirmation: axe sin violaciones, un solo h1', async () => {
    const { container } = render(<CheckoutConfirmation order={orden} />);

    expect(await axe(container)).toHaveNoViolations();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('los tres campos del comprador tienen nombre accesible por su <label>, sin aria-label redundante', () => {
    render(<CheckoutForm onSuccess={vi.fn()} />);

    for (const nombre of [/nombre/i, /email/i, /teléfono/i]) {
      const input = screen.getByLabelText(nombre);
      expect(input).not.toHaveAttribute('aria-label');
    }
  });
});
