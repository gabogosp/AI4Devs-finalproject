import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => vi.clearAllMocks());
import { AppErrorException } from '@/lib/http/errors';
import type { CheckoutCreated, CreateCheckoutRequest } from './checkoutService';
import { checkoutService } from './checkoutService';
import { useCheckout, type CheckoutState } from './useCheckout';

vi.mock('./checkoutService', () => ({
  checkoutService: { submit: vi.fn() },
}));

const servicio = vi.mocked(checkoutService);

const input: CreateCheckoutRequest = {
  buyer: { name: 'Ana Gómez', email: 'ana@example.com', phone: '+54 9 11 5555 5555' },
  consent: true,
  fulfillment: 'pickup',
};

const orden: CheckoutCreated = {
  order_token: 'a'.repeat(64),
  order_number: 1000,
  status: 'pending_payment',
  total_ars_cents: 640000,
  items_count: 1,
};

describe('useCheckout — reducer puro', () => {
  it('idle → submitting → success en el camino feliz', async () => {
    servicio.submit.mockResolvedValue(orden);
    const { result } = renderHook(() => useCheckout());

    expect(result.current.state.kind).toBe('idle');

    let promesa!: Promise<void>;
    act(() => {
      promesa = result.current.submit(input);
    });
    expect(result.current.state.kind).toBe('submitting');

    await act(() => promesa);
    expect(result.current.state).toEqual({ kind: 'success', order: orden });
  });

  it('en fallo transiciona a error', async () => {
    servicio.submit.mockRejectedValue(
      new AppErrorException({ kind: 'network', message: 'Sin conexión' }),
    );
    const { result } = renderHook(() => useCheckout());

    await act(() => result.current.submit(input));

    const state: CheckoutState = result.current.state;
    expect(state.kind).toBe('error');
    if (state.kind === 'error') {
      expect(state.error.kind).toBe('network');
    }
  });

  it('un reintento desde error vuelve a submitting', async () => {
    servicio.submit.mockRejectedValueOnce(
      new AppErrorException({ kind: 'network', message: 'Sin conexión' }),
    );
    servicio.submit.mockResolvedValueOnce(orden);
    const { result } = renderHook(() => useCheckout());

    await act(() => result.current.submit(input));
    expect(result.current.state.kind).toBe('error');

    let promesa!: Promise<void>;
    act(() => {
      promesa = result.current.submit(input);
    });
    expect(result.current.state.kind).toBe('submitting');
    await act(() => promesa);
    expect(result.current.state.kind).toBe('success');
  });
});

describe('useCheckout — single-flight', () => {
  it('dos submit simultáneos disparan un solo POST', async () => {
    let resolver: (v: CheckoutCreated) => void = () => {};
    servicio.submit.mockReturnValue(
      new Promise<CheckoutCreated>((r) => {
        resolver = r;
      }),
    );
    const { result } = renderHook(() => useCheckout());

    let p1!: Promise<void>;
    let p2!: Promise<void>;
    act(() => {
      p1 = result.current.submit(input);
      p2 = result.current.submit(input);
    });

    expect(servicio.submit).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolver(orden);
      await Promise.all([p1, p2]);
    });
    await waitFor(() => expect(result.current.state.kind).toBe('success'));
  });
});
