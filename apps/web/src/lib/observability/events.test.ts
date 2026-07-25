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
});
