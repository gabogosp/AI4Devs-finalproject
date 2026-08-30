import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CheckoutBlocked } from './CheckoutBlocked';

describe('CheckoutBlocked — entrada bloqueada (AC-5)', () => {
  it('empty y not_purchasable producen textos DISTINTOS', () => {
    const { unmount } = render(<CheckoutBlocked reason="empty" />);
    const vacio = document.body.textContent ?? '';
    unmount();

    render(<CheckoutBlocked reason="not_purchasable" />);
    const noComprable = document.body.textContent ?? '';

    expect(vacio).not.toBe(noComprable);
  });

  it('el link vuelve a /carrito', () => {
    render(<CheckoutBlocked reason="empty" />);

    expect(screen.getByRole('link', { name: /volver al carrito/i })).toHaveAttribute(
      'href',
      '/carrito',
    );
  });
});
