import { describe, expect, it, vi } from 'vitest';
import { setEventSink, track } from './events';

describe('observability — eventos de negocio', () => {
  it('track emite al sink con operator_id pseudónimo + correlation_id', () => {
    const sink = vi.fn();
    setEventSink(sink);
    track('product_published', { product_id: 'p1', correlation_id: 'c1' });
    expect(sink).toHaveBeenCalledWith(
      'product_published',
      expect.objectContaining({
        product_id: 'p1',
        operator_id: 'admin',
        correlation_id: 'c1',
      }),
    );
  });

  it('sin props explícitas igual incluye operator_id', () => {
    const sink = vi.fn();
    setEventSink(sink);
    track('category_created');
    expect(sink).toHaveBeenCalledWith(
      'category_created',
      expect.objectContaining({ operator_id: 'admin' }),
    );
  });

  describe('eventos de cuenta (US-014 T5.1)', () => {
    const EVENTOS_DE_CUENTA = [
      'account_registered',
      'login_succeeded',
      'login_failed',
      'logout',
      'password_reset_requested',
      'password_reset_completed',
      'session_expired',
    ] as const;

    it('ninguno lleva operator_id: los emite un cliente, no el dueño', () => {
      const sink = vi.fn();
      setEventSink(sink);

      for (const evento of EVENTOS_DE_CUENTA) track(evento);

      // Si alguien suma un evento de cuenta y se olvida de PUBLIC_EVENTS, cada
      // login de un cliente quedaría etiquetado como acción del dueño y
      // ensuciaría las métricas de US-016.
      for (const [, props] of sink.mock.calls) {
        expect(props).not.toHaveProperty('operator_id');
      }
      expect(sink).toHaveBeenCalledTimes(EVENTOS_DE_CUENTA.length);
    });

    it('login_failed no acepta discriminadores por accidente: se emite sin props', () => {
      const sink = vi.fn();
      setEventSink(sink);

      track('login_failed');

      expect(sink).toHaveBeenCalledWith('login_failed', {});
    });
  });
});
