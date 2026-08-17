import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { ProductViewTracker } from './ProductViewTracker';
import { setEventSink, type BusinessEvent, type EventProps } from '@/lib/observability/events';

const PROPS = { slug: 'heladera-exhibidora', sku: 'REF-001', inStock: true };

describe('ProductViewTracker', () => {
  let events: Array<{ event: BusinessEvent; props: EventProps }>;

  beforeEach(() => {
    events = [];
    setEventSink((event, props) => events.push({ event, props }));
  });

  afterEach(() => setEventSink(() => {}));

  it('emite pdp_shown con slug, sku, stock y pantalla', () => {
    render(<ProductViewTracker {...PROPS} />);

    expect(events).toHaveLength(1);
    expect(events[0].event).toBe('pdp_shown');
    expect(events[0].props).toMatchObject({
      slug: 'heladera-exhibidora',
      sku: 'REF-001',
      in_stock: true,
      screen_name: 'pdp',
    });
  });

  it('no emite ninguna propiedad con PII ni marca al visitante como operador', () => {
    render(<ProductViewTracker {...PROPS} />);

    const props = events[0].props;
    // Una lectura pública es anónima: no hay email, nombre, ni operator_id.
    expect(props.operator_id).toBeUndefined();
    for (const key of ['email', 'name', 'phone', 'user_id', 'ip']) {
      expect(props[key]).toBeUndefined();
    }
  });

  it('emite exactamente una vez aunque el componente re-renderice', () => {
    const { rerender } = render(<ProductViewTracker {...PROPS} />);
    rerender(<ProductViewTracker {...PROPS} />);
    rerender(<ProductViewTracker {...PROPS} />);

    expect(events).toHaveLength(1);
  });

  it('refleja el estado sin stock', () => {
    render(<ProductViewTracker {...PROPS} inStock={false} />);

    expect(events[0].props.in_stock).toBe(false);
  });
});
