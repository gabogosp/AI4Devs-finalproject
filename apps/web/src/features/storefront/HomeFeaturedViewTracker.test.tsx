import { beforeEach, describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { setEventSink, type BusinessEvent, type EventProps } from '@/lib/observability/events';
import { HomeFeaturedViewTracker } from './HomeFeaturedViewTracker';

const emitted: { event: BusinessEvent; props: EventProps }[] = [];

beforeEach(() => {
  emitted.length = 0;
  setEventSink((event, props) => emitted.push({ event, props }));
});

describe('HomeFeaturedViewTracker (US-026 T-A4)', () => {
  it('emite exactamente un home_featured_shown al montar, sin PII', () => {
    render(<HomeFeaturedViewTracker sectionId="novedades" itemCount={8} />);

    expect(emitted).toHaveLength(1);
    expect(emitted[0].event).toBe('home_featured_shown');
    expect(emitted[0].props).toMatchObject({
      section: 'novedades',
      item_count: 8,
      screen_name: 'home',
    });
  });

  it('NO lleva operator_id: es una visita anónima, no una acción del dueño', () => {
    render(<HomeFeaturedViewTracker sectionId="mas-vendidos" itemCount={5} />);

    // Sin el registro en PUBLIC_EVENTS, cada visita anónima se etiquetaría
    // como acción del dueño y ensuciaría las métricas de US-016.
    expect(emitted[0].props.operator_id).toBeUndefined();
  });

  it('un re-render con las mismas props no vuelve a emitir (guard de StrictMode)', () => {
    const { rerender } = render(
      <HomeFeaturedViewTracker sectionId="novedades" itemCount={8} />,
    );
    rerender(<HomeFeaturedViewTracker sectionId="novedades" itemCount={8} />);

    expect(emitted).toHaveLength(1);
  });

  it('cambiar de sección SÍ emite una vista nueva', () => {
    const { rerender } = render(
      <HomeFeaturedViewTracker sectionId="novedades" itemCount={8} />,
    );
    rerender(<HomeFeaturedViewTracker sectionId="mas-vendidos" itemCount={3} />);

    expect(emitted).toHaveLength(2);
    expect(emitted[1].props.section).toBe('mas-vendidos');
    expect(emitted[1].props.item_count).toBe(3);
  });

  it('no renderiza ninguna salida visual', () => {
    const { container } = render(
      <HomeFeaturedViewTracker sectionId="novedades" itemCount={8} />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
