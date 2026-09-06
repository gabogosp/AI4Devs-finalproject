import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { AppErrorException } from '@/lib/http/errors';
import { SessionProvider } from '@/features/account/SessionProvider';
import { SESSION_HINT_KEY } from '@/features/account/sessionState';
import type { CheckoutCreated } from './checkoutService';
import { checkoutService } from './checkoutService';
import { CheckoutForm } from './CheckoutForm';

const SITE = 'http://localhost:3000';

vi.mock('./checkoutService', () => ({
  checkoutService: { submit: vi.fn() },
}));

const servicio = vi.mocked(checkoutService);

afterEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
});

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
    render(<SessionProvider><CheckoutForm onSuccess={vi.fn()} /></SessionProvider>);
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
    render(<SessionProvider><CheckoutForm onSuccess={vi.fn()} /></SessionProvider>);
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
    render(<SessionProvider><CheckoutForm onSuccess={vi.fn()} /></SessionProvider>);
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
    render(<SessionProvider><CheckoutForm onSuccess={vi.fn()} /></SessionProvider>);
    const user = userEvent.setup();
    await completarValido(user);

    await user.click(screen.getByRole('button', { name: /confirmar pedido/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/recargá la página/i);
  });

  it('éxito: invoca onSuccess con el CheckoutCreated', async () => {
    servicio.submit.mockResolvedValue(orden);
    const onSuccess = vi.fn();
    render(<SessionProvider><CheckoutForm onSuccess={onSuccess} /></SessionProvider>);
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
    render(<SessionProvider><CheckoutForm onSuccess={vi.fn()} /></SessionProvider>);
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

describe('CheckoutForm — precarga de buyer.name desde la sesión (US-024 AC-1, T2.5)', () => {
  const customer = {
    id: '55555555-5555-4555-8555-555555555555',
    email: 'ana@example.com',
    name: 'Ana Gómez',
    phone: null,
    avatar_url: null,
    created_at: '2026-08-22T12:00:00Z',
  };

  it('anónimo: buyer.name arranca vacío, comportamiento idéntico al actual', async () => {
    render(<SessionProvider><CheckoutForm onSuccess={vi.fn()} /></SessionProvider>);

    expect(screen.getByLabelText(/nombre/i)).toHaveValue('');
  });

  it('logueado: buyer.name arranca precargado con el nombre de la sesión', async () => {
    window.localStorage.setItem(SESSION_HINT_KEY, '1');
    server.use(http.get(`${SITE}/v1/auth/me`, () => HttpResponse.json(customer)));

    render(<SessionProvider><CheckoutForm onSuccess={vi.fn()} /></SessionProvider>);

    await waitFor(() => expect(screen.getByLabelText(/nombre/i)).toHaveValue('Ana Gómez'));
  });

  it('el campo sigue editable estando logueado (comprar para otra persona)', async () => {
    window.localStorage.setItem(SESSION_HINT_KEY, '1');
    server.use(http.get(`${SITE}/v1/auth/me`, () => HttpResponse.json(customer)));

    render(<SessionProvider><CheckoutForm onSuccess={vi.fn()} /></SessionProvider>);
    await waitFor(() => expect(screen.getByLabelText(/nombre/i)).toHaveValue('Ana Gómez'));

    const user = userEvent.setup();
    await user.clear(screen.getByLabelText(/nombre/i));
    await user.type(screen.getByLabelText(/nombre/i), 'Otra Persona');

    expect(screen.getByLabelText(/nombre/i)).toHaveValue('Otra Persona');
  });

  it('si la persona escribe ANTES de que la sesión resuelva, su edición no se pierde (keepDirtyValues real)', async () => {
    window.localStorage.setItem(SESSION_HINT_KEY, '1');
    server.use(
      http.get(`${SITE}/v1/auth/me`, async () => {
        // Resolución demorada: da tiempo a escribir antes de que la sesión
        // pase a `authenticated` — el escenario real que `keepDirtyValues`
        // existe para cubrir.
        await new Promise((r) => setTimeout(r, 50));
        return HttpResponse.json(customer);
      }),
    );

    render(<SessionProvider><CheckoutForm onSuccess={vi.fn()} /></SessionProvider>);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/nombre/i), 'Escrito Antes');

    // Esperar a que la sesión efectivamente resuelva (más que el delay de arriba).
    await act(() => new Promise((r) => setTimeout(r, 100)));

    expect(screen.getByLabelText(/nombre/i)).toHaveValue('Escrito Antes');
  });
});
