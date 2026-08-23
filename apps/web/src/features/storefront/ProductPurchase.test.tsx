import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  setEventSink,
  type BusinessEvent,
  type EventProps,
} from '@/lib/observability/events';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProductPurchase } from './ProductPurchase';
import { CartProvider } from '@/features/cart/CartProvider';

// `AddToCartButton` (US-007) vive dentro del CTA con stock, así que necesita el
// provider y el servicio mockeado. El resto de los casos no cambia.
vi.mock('@/features/cart/cartService', () => ({
  cartService: {
    get: vi.fn().mockResolvedValue({
      id: null,
      items: [],
      item_count: 0,
      total_quantity: 0,
      total_ars_cents: 0,
      has_blocking_issues: false,
      updated_at: null,
    }),
    setItemQuantity: vi.fn(),
    removeItem: vi.fn(),
  },
}));

function renderConCarrito(ui: React.ReactElement) {
  return render(<CartProvider>{ui}</CartProvider>);
}

describe('ProductPurchase — con stock (AC-3)', () => {
  // US-007 T3.4 — reescrito: el `disabled` era un cartel de roadmap y este change
  // lo apaga. Es la única excepción autorizada al «tests existentes sin editar».
  it('ofrece «Agregar al carrito» HABILITADO (US-007)', () => {
    renderConCarrito(
      <ProductPurchase inStock productName="Heladera exhibidora" productSlug="heladera-exhibidora" />,
    );

    const cta = screen.getByRole('button', { name: 'Agregar al carrito' });
    expect(cta).toBeInTheDocument();
    expect(cta).toBeEnabled();
  });

  it('indica disponibilidad con texto, no sólo con color', () => {
    renderConCarrito(<ProductPurchase inStock productName="Heladera exhibidora" productSlug="heladera-exhibidora" />);

    expect(screen.getByText('En stock')).toBeInTheDocument();
  });

  it('conserva el canal de WhatsApp junto al carrito', () => {
    renderConCarrito(<ProductPurchase inStock productName="Heladera exhibidora" productSlug="heladera-exhibidora" />);

    const link = screen.getByRole('link', { name: /Consultar por WhatsApp/ });
    expect(link).toHaveAttribute('href', expect.stringContaining('https://wa.me/'));
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('precarga el mensaje de WhatsApp con el nombre del producto (con stock)', () => {
    renderConCarrito(<ProductPurchase inStock productName="Heladera exhibidora" productSlug="heladera-exhibidora" />);

    const href = screen.getByRole('link', { name: /WhatsApp/ }).getAttribute('href') ?? '';
    expect(decodeURIComponent(href)).toContain('Heladera exhibidora');
  });
});

describe('ProductPurchase — sin stock (AC-4)', () => {
  it('NO renderiza el botón de compra en el DOM', () => {
    render(<ProductPurchase inStock={false} productName="Heladera exhibidora" productSlug="heladera-exhibidora" />);

    // No basta con que esté deshabilitado: el §7.3 exige reemplazarlo.
    expect(
      screen.queryByRole('button', { name: 'Agregar al carrito' }),
    ).not.toBeInTheDocument();
  });

  it('muestra el badge "Sin stock" con texto', () => {
    render(<ProductPurchase inStock={false} productName="Heladera exhibidora" productSlug="heladera-exhibidora" />);

    expect(screen.getByText('Sin stock')).toBeInTheDocument();
  });

  it('ofrece el canal WhatsApp con nombre accesible y enlace a wa.me', () => {
    render(<ProductPurchase inStock={false} productName="Heladera exhibidora" productSlug="heladera-exhibidora" />);

    const link = screen.getByRole('link', { name: /Avisame por WhatsApp/ });
    expect(link).toHaveAttribute('href', expect.stringContaining('https://wa.me/'));
    // El nombre accesible viene del texto, no sólo del ícono.
    expect(link).toHaveTextContent('Avisame por WhatsApp');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('precarga el mensaje de WhatsApp con el nombre del producto', () => {
    render(<ProductPurchase inStock={false} productName="Heladera exhibidora" productSlug="heladera-exhibidora" />);

    const href = screen.getByRole('link', { name: /WhatsApp/ }).getAttribute('href') ?? '';
    expect(decodeURIComponent(href)).toContain('Heladera exhibidora');
  });

  it('explica la situación con el copy del design-system §10.2', () => {
    render(<ProductPurchase inStock={false} productName="Heladera exhibidora" productSlug="heladera-exhibidora" />);

    expect(
      screen.getByText(
        'Sin stock por ahora. Escribinos por WhatsApp y te avisamos cuando vuelva.',
      ),
    ).toBeInTheDocument();
  });
});

describe('whatsapp_click — salida al canal humano (OQ-FE-13)', () => {
  let eventos: Array<{ event: BusinessEvent; props: EventProps }>;

  beforeEach(() => {
    eventos = [];
    setEventSink((event, props) => eventos.push({ event, props }));
  });
  afterEach(() => setEventSink(() => {}));

  it('sin stock emite el evento con contexto y slug', async () => {
    render(
      <ProductPurchase
        inStock={false}
        productName="Heladera exhibidora"
        productSlug="heladera-exhibidora"
      />,
    );

    await userEvent.click(screen.getByRole('link', { name: /WhatsApp/ }));

    expect(eventos).toHaveLength(1);
    expect(eventos[0].event).toBe('whatsapp_click');
    expect(eventos[0].props).toMatchObject({
      context: 'pdp_out_of_stock',
      product_slug: 'heladera-exhibidora',
    });
  });

  it('con stock distingue el contexto del canal humano', async () => {
    renderConCarrito(
      <ProductPurchase
        inStock
        productName="Heladera exhibidora"
        productSlug="heladera-exhibidora"
      />,
    );

    await userEvent.click(screen.getByRole('link', { name: /WhatsApp/ }));

    expect(eventos[0].props).toMatchObject({ context: 'pdp_in_stock' });
  });

  it('no etiqueta al visitante como operador ni filtra PII', async () => {
    render(
      <ProductPurchase
        inStock={false}
        productName="Heladera exhibidora"
        productSlug="heladera-exhibidora"
      />,
    );

    await userEvent.click(screen.getByRole('link', { name: /WhatsApp/ }));

    // Un evento de visitante anónimo etiquetado como acción del dueño
    // ensuciaría las métricas de US-016, igual que habría pasado con pdp_shown.
    expect(eventos[0].props.operator_id).toBeUndefined();
    for (const pii of ['email', 'phone', 'message', 'text']) {
      expect(eventos[0].props[pii]).toBeUndefined();
    }
  });
});

