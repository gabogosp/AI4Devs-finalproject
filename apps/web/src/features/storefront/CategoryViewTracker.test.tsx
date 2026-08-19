import { beforeEach, describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { setEventSink, type BusinessEvent, type EventProps } from '@/lib/observability/events';
import { CategoryViewTracker } from './CategoryViewTracker';

const emitted: { event: BusinessEvent; props: EventProps }[] = [];

beforeEach(() => {
  emitted.length = 0;
  setEventSink((event, props) => emitted.push({ event, props }));
});

describe('CategoryViewTracker (US §9)', () => {
  it('emite exactamente un category_shown al montar, sin PII', () => {
    render(
      <CategoryViewTracker slug="climatizacion" isRubro page={1} productCount={12} />,
    );

    expect(emitted).toHaveLength(1);
    expect(emitted[0].event).toBe('category_shown');
    expect(emitted[0].props).toMatchObject({
      slug: 'climatizacion',
      is_rubro: true,
      page: 1,
      product_count: 12,
      screen_name: 'category',
    });
  });

  it('NO lleva operator_id: es una visita anónima, no una acción del dueño', () => {
    render(<CategoryViewTracker slug="climatizacion" isRubro page={1} productCount={0} />);

    // Sin el registro en PUBLIC_EVENTS, cada visita anónima se etiquetaría como
    // acción del dueño y ensuciaría las métricas de US-016.
    expect(emitted[0].props.operator_id).toBeUndefined();
  });

  it('un re-render con las mismas props no vuelve a emitir', () => {
    const { rerender } = render(
      <CategoryViewTracker slug="climatizacion" isRubro page={1} productCount={12} />,
    );
    rerender(
      <CategoryViewTracker slug="climatizacion" isRubro page={1} productCount={12} />,
    );

    expect(emitted).toHaveLength(1);
  });

  it('cambiar de página SÍ emite una vista nueva', () => {
    const { rerender } = render(
      <CategoryViewTracker slug="climatizacion" isRubro page={1} productCount={20} />,
    );
    rerender(
      <CategoryViewTracker slug="climatizacion" isRubro page={2} productCount={5} />,
    );

    expect(emitted).toHaveLength(2);
    expect(emitted[1].props.page).toBe(2);
  });
});
