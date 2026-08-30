import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppErrorException } from '@/lib/http/errors';
import type { CheckoutCreated } from './checkoutService';
import { checkoutService } from './checkoutService';
import { CheckoutForm } from './CheckoutForm';

vi.mock('./checkoutService', () => ({
  checkoutService: { submit: vi.fn() },
}));

const servicio = vi.mocked(checkoutService);

afterEach(() => vi.clearAllMocks());

const orden: CheckoutCreated = {
  order_token: 'a'.repeat(64),
  order_number: 1000,
  status: 'pending_payment',
  total_ars_cents: 640000,
  items_count: 1,
};

async function completarValido(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/nombre/i), 'Ana Gómez');
  await user.type(screen.getByLabelText(/email/i), 'ana@example.com');
  await user.type(screen.getByLabelText(/teléfono/i), '+54 9 11 5555 5555');
  await user.click(screen.getByRole('checkbox'));
}

describe('CheckoutForm — validación cliente (AC-3, AC-4)', () => {
  it('submit vacío: 3 errores inline + el del checkbox, sin llamar al servicio', async () => {
    render(<CheckoutForm onSuccess={vi.fn()} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /confirmar pedido/i }));

    expect(await screen.findByText(/ingresá tu nombre/i)).toBeInTheDocument();
    expect(screen.getByText(/ingresá un email válido/i)).toBeInTheDocument();
    expect(screen.getByText(/ingresá un teléfono válido/i)).toBeInTheDocument();
    expect(screen.getByText(/tenés que aceptar los términos/i)).toBeInTheDocument();
    expect(servicio.submit).not.toHaveBeenCalled();
  });
});

describe('CheckoutForm — errores del servidor (D5)', () => {
  it('422 con field: buyer.email marca ESE campo y ningún otro', async () => {
    servicio.submit.mockRejectedValue(
      new AppErrorException({
        kind: 'validation',
        message: 'Revisá los campos',
        fieldErrors: [{ field: 'buyer.email', message: 'Ese email no es válido para nosotros' }],
      }),
    );
    render(<CheckoutForm onSuccess={vi.fn()} />);
    const user = userEvent.setup();
    await completarValido(user);

    await user.click(screen.getByRole('button', { name: /confirmar pedido/i }));

    expect(await screen.findByText(/ese email no es válido para nosotros/i)).toBeInTheDocument();
    expect(screen.queryByText(/ingresá tu nombre/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/ingresá un teléfono válido/i)).not.toBeInTheDocument();
  });

  it('409 cart-not-purchasable: banner + link a /carrito', async () => {
    servicio.submit.mockRejectedValue(
      new AppErrorException({
        kind: 'conflict',
        message: 'x',
        problemType: 'dsm:checkout/cart-not-purchasable',
      }),
    );
    render(<CheckoutForm onSuccess={vi.fn()} />);
    const user = userEvent.setup();
    await completarValido(user);

    await user.click(screen.getByRole('button', { name: /confirmar pedido/i }));

    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toMatch(/carrito cambió/i);
    expect(screen.getByRole('link', { name: /ir al carrito/i })).toHaveAttribute(
      'href',
      '/carrito',
    );
  });

  it('403 → banner "Recargá la página…"', async () => {
    servicio.submit.mockRejectedValue(
      new AppErrorException({ kind: 'forbidden', message: 'x' }),
    );
    render(<CheckoutForm onSuccess={vi.fn()} />);
    const user = userEvent.setup();
    await completarValido(user);

    await user.click(screen.getByRole('button', { name: /confirmar pedido/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/recargá la página/i);
  });

  it('éxito: invoca onSuccess con el CheckoutCreated', async () => {
    servicio.submit.mockResolvedValue(orden);
    const onSuccess = vi.fn();
    render(<CheckoutForm onSuccess={onSuccess} />);
    const user = userEvent.setup();
    await completarValido(user);

    await user.click(screen.getByRole('button', { name: /confirmar pedido/i }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(orden));
  });

  it('submit deshabilitado con aria-busy mientras está en vuelo', async () => {
    let resolver: (v: CheckoutCreated) => void = () => {};
    servicio.submit.mockReturnValue(
      new Promise<CheckoutCreated>((r) => {
        resolver = r;
      }),
    );
    render(<CheckoutForm onSuccess={vi.fn()} />);
    const user = userEvent.setup();
    await completarValido(user);

    await user.click(screen.getByRole('button', { name: /confirmar pedido/i }));

    const boton = await screen.findByRole('button', { name: /confirmando/i });
    expect(boton).toBeDisabled();
    expect(boton).toHaveAttribute('aria-busy', 'true');

    // Se resuelve antes de terminar: una promesa pendiente filtra trabajo al
    // test siguiente y lo cuelga (mismo criterio que CartPage.test.tsx).
    await waitFor(() => resolver(orden));
  });
});
