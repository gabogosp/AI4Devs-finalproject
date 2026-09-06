import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  usePathname: () => '/productos/compresor-embraco',
}));

const { ReviewGuestPrompt } = await import('./ReviewGuestPrompt');

describe('ReviewGuestPrompt (T-A6, AC-7)', () => {
  it('explica que se necesita una cuenta y linkea a crear cuenta e ingresar con next= codificado', () => {
    render(<ReviewGuestPrompt />);

    expect(
      screen.getByText(/necesitás una cuenta para dejar una reseña/i),
    ).toBeInTheDocument();

    const crearCuenta = screen.getByRole('link', { name: /crear una cuenta/i });
    expect(crearCuenta).toHaveAttribute('href', '/crear-cuenta');

    const ingresar = screen.getByRole('link', { name: /ingresar/i });
    expect(ingresar).toHaveAttribute(
      'href',
      '/ingresar?next=%2Fproductos%2Fcompresor-embraco',
    );
  });
});
