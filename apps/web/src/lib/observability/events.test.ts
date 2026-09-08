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

  describe('eventos del panel de métricas (US-016 T10.1)', () => {
    const EVENTOS_DE_METRICAS = [
      'metrics_shown',
      'metrics_range_changed',
      'metrics_export_downloaded',
    ] as const;

    it('los 3 incluyen operator_id: admin por default (backoffice)', () => {
      const sink = vi.fn();
      setEventSink(sink);

      for (const evento of EVENTOS_DE_METRICAS) track(evento);

      for (const [, props] of sink.mock.calls) {
        expect(props).toMatchObject({ operator_id: 'admin' });
      }
      expect(sink).toHaveBeenCalledTimes(EVENTOS_DE_METRICAS.length);
    });

    it('metrics_export_downloaded lleva sólo {dataset}, nunca un rango de fechas', () => {
      const sink = vi.fn();
      setEventSink(sink);

      track('metrics_export_downloaded', { dataset: 'sales' });

      expect(sink).toHaveBeenCalledWith(
        'metrics_export_downloaded',
        expect.objectContaining({ dataset: 'sales', operator_id: 'admin' }),
      );
      const [, props] = sink.mock.calls[0];
      expect(props).not.toHaveProperty('from');
      expect(props).not.toHaveProperty('to');
    });

    it('ninguno lleva PII', () => {
      const sink = vi.fn();
      setEventSink(sink);

      track('metrics_shown');
      track('metrics_range_changed');
      track('metrics_export_downloaded', { dataset: 'top-products' });

      for (const [, props] of sink.mock.calls) {
        const serializado = JSON.stringify(props);
        expect(serializado).not.toMatch(/email|buyer|password|@/i);
      }
    });
  });

  describe('eventos de reseñas (US-025 T-B5)', () => {
    const EVENTOS_DE_RESENAS = [
      'review_shown',
      'review_submitted',
      'review_submit_failed',
    ] as const;

    it('ninguno lleva operator_id: los emite un cliente/visitante, no el dueño', () => {
      const sink = vi.fn();
      setEventSink(sink);

      for (const evento of EVENTOS_DE_RESENAS) track(evento);

      for (const [, props] of sink.mock.calls) {
        expect(props).not.toHaveProperty('operator_id');
      }
      expect(sink).toHaveBeenCalledTimes(EVENTOS_DE_RESENAS.length);
    });

    it('el tipo de props rechaza comment/authorName en compilación (observability-standards §9)', () => {
      // @ts-expect-error — el comentario es texto libre del cliente, nunca telemetría.
      track('review_submitted', { comment: 'Excelente producto' });
      // @ts-expect-error — el nombre del autor es PII, nunca telemetría.
      track('review_shown', { authorName: 'Ana Gómez' });

      // Sin este assert el test sería sólo una comprobación de tipos (útil,
      // pero silenciosa) — confirma además que la llamada emite igual, sin
      // las props prohibidas colándose por el spread.
      const sink = vi.fn();
      setEventSink(sink);
      track('review_submitted');
      expect(sink).toHaveBeenCalledWith('review_submitted', {});
    });
  });

  describe('home_featured_shown (US-026 T-A3)', () => {
    it('está en la superficie pública: no lleva operator_id', () => {
      const sink = vi.fn();
      setEventSink(sink);

      track('home_featured_shown', {
        section: 'novedades',
        item_count: 8,
        screen_name: 'home',
      });

      expect(sink).toHaveBeenCalledWith(
        'home_featured_shown',
        expect.objectContaining({ section: 'novedades', item_count: 8, screen_name: 'home' }),
      );
      const [, props] = sink.mock.calls[0];
      expect(props).not.toHaveProperty('operator_id');
    });
  });
});
