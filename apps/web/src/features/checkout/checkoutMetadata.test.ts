import { describe, expect, it } from 'vitest';
import { checkoutMetadata } from './checkoutMetadata';
import { metadata } from '@/../app/(storefront)/checkout/page';

describe('checkoutMetadata', () => {
  it('declara noindex (PII del comprador, no es contenido público)', () => {
    const robots = checkoutMetadata.robots as { index?: boolean; follow?: boolean };

    expect(robots.index).toBe(false);
  });

  it('deja follow en true', () => {
    const robots = checkoutMetadata.robots as { index?: boolean; follow?: boolean };

    expect(robots.follow).toBe(true);
  });

  it('la página exporta EXACTAMENTE estos metadatos', () => {
    expect(metadata).toBe(checkoutMetadata);
  });
});
