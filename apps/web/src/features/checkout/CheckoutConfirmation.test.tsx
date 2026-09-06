import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatArs } from '@/lib/format/currency';
import type { CheckoutCreated } from './checkoutService';
import { saveOrderToken } from './orderToken';
import { CheckoutConfirmation } from './CheckoutConfirmation';

vi.mock('./orderToken', () => ({ saveOrderToken: vi.fn() }));

const guardar = vi.mocked(saveOrderToken);

const orden: CheckoutCreated = {
  order_token: 'a'.repeat(64),
  order_number: 1234,
  status: 'pending_payment',
  total_ars_cents: 640000,
  items_count: 1,
};

describe('CheckoutConfirmation — post-201 (D8)', () => {
  afterEach(() => vi.clearAllMocks());

  it('muestra order_number y total, con heading propio', () => {
    render(<CheckoutConfirmation order={orden} />);

    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(screen.getByText(/1234/)).toBeInTheDocument();
    expect(document.body.textContent).toContain(formatArs(640000));
  });

  it('ofrece coordinar el pago por WhatsApp, con el número de pedido en el mensaje', () => {
    render(<CheckoutConfirmation order={orden} />);

    const link = screen.getByRole('link', { name: /coordinar.*pago.*whatsapp/i });
    expect(link).toHaveAttribute('href', expect.stringContaining('wa.me'));
    expect(decodeURIComponent(link.getAttribute('href') ?? '')).toContain(
      `#${orden.order_number}`,
    );
  });

  it('saveOrderToken se llama UNA vez en mount, cero en un re-render con las mismas props', () => {
    const { rerender } = render(<CheckoutConfirmation order={orden} />);

    expect(guardar).toHaveBeenCalledTimes(1);
    expect(guardar).toHaveBeenCalledWith(orden.order_token);

    rerender(<CheckoutConfirmation order={orden} />);

    expect(guardar).toHaveBeenCalledTimes(1);
  });
});
