import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { whatsappHref, WHATSAPP_MESSAGES } from './whatsapp';
import { ProductPurchase } from '@/features/storefront/ProductPurchase';

vi.mock('@/features/storefront/CategoryNav', () => ({ CategoryNav: () => null }));

const { default: StorefrontLayout } = await import(
  '../../../app/(storefront)/layout'
);

/**
 * AC-4: el contacto se resuelve con el enlace estándar `wa.me`, **sin llamar al
 * backend** y sin exponer datos sensibles.
 *
 * Se espía `globalThis.fetch` —por **debajo** de `customFetch`, que es el único
 * punto de red del repo (F48)— en vez de grepear la palabra `fetch`. Un grep
 * daría verde si alguien importara un servicio que internamente llama a
 * `customFetch`, que es exactamente cómo se rompería este criterio.
 */
describe('AC-4 — el contacto no toca la red', () => {
  afterEach(() => vi.restoreAllMocks());

  it('ninguna de las tres superficies de contacto hace un request', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    render(StorefrontLayout({ children: <p>x</p> })); // header + footer
    render(<ProductPurchase inStock={false} productName="Heladera exhibidora" />);
    render(<ProductPurchase inStock productName="Heladera exhibidora" />);

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('AC-4 — nada sensible viaja en el enlace', () => {
  it('la URL no lleva más parámetros que el texto del mensaje', () => {
    const url = new URL(whatsappHref(WHATSAPP_MESSAGES.product('Heladera exhibidora')));

    expect([...url.searchParams.keys()]).toEqual(['text']);
  });

  it('el mensaje prellenado no filtra precio, SKU, email ni tokens', () => {
    const url = new URL(whatsappHref(WHATSAPP_MESSAGES.product('Heladera exhibidora')));
    const text = (url.searchParams.get('text') ?? '').toLowerCase();

    // Fallaría el día que alguien "mejore" el prellenado agregando el carrito,
    // el email del cliente o un identificador de sesión.
    for (const filtracion of ['1250000', 'ref-001', '@', 'token', 'email', 'precio']) {
      expect(text).not.toContain(filtracion);
    }
  });

  it('el mensaje genérico tampoco lleva identificadores', () => {
    const url = new URL(whatsappHref(WHATSAPP_MESSAGES.general));
    const text = (url.searchParams.get('text') ?? '').toLowerCase();

    for (const filtracion of ['@', 'token', 'id=', 'session']) {
      expect(text).not.toContain(filtracion);
    }
  });
});
