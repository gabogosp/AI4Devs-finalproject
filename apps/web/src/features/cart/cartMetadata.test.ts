import { describe, expect, it } from 'vitest';
import { cartMetadata } from './cartMetadata';
import { metadata } from '@/../app/(storefront)/carrito/page';

describe('cartMetadata', () => {
  it('declara noindex (un carrito no es contenido público)', () => {
    const robots = cartMetadata.robots as { index?: boolean; follow?: boolean };

    expect(robots.index).toBe(false);
  });

  it('deja follow en true: los enlaces del layout se siguen rastreando', () => {
    const robots = cartMetadata.robots as { index?: boolean; follow?: boolean };

    // `nofollow` acá no protegería nada y cortaría el rastreo de rubros y fichas,
    // que sí queremos indexadas (US-002/US-003).
    expect(robots.follow).toBe(true);
  });

  it('la página exporta EXACTAMENTE estos metadatos', () => {
    // Sin este assert, alguien podría dejar de exportarlos y `/carrito` entraría
    // al índice sin que ningún test se queje.
    expect(metadata).toBe(cartMetadata);
  });
});
