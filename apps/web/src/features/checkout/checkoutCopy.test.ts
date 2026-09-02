import { describe, expect, it } from 'vitest';
import { checkoutBannerFor } from './checkoutCopy';

describe('checkoutCopy — banners por AppError.kind (D5)', () => {
  it('validation → banner genérico "Revisá los campos marcados."', () => {
    expect(
      checkoutBannerFor({ kind: 'validation', message: 'x', fieldErrors: [] }).message,
    ).toMatch(/revisá los campos/i);
  });

  it('conflict cart-empty y cart-not-purchasable son textos DISTINTOS', () => {
    const vacio = checkoutBannerFor({
      kind: 'conflict',
      message: 'x',
      problemType: 'dsm:checkout/cart-empty',
    });
    const noComprable = checkoutBannerFor({
      kind: 'conflict',
      message: 'x',
      problemType: 'dsm:checkout/cart-not-purchasable',
    });

    expect(vacio.message).not.toBe(noComprable.message);
    expect(vacio.linkToCart).toBe(true);
    expect(noComprable.linkToCart).toBe(true);
  });

  it('forbidden → "Recargá la página…"', () => {
    expect(checkoutBannerFor({ kind: 'forbidden', message: 'x' }).message).toMatch(/recargá/i);
  });

  it('rateLimited con retryAfterSeconds usa el minuto/segundo correcto', () => {
    expect(
      checkoutBannerFor({ kind: 'rateLimited', message: 'x', retryAfterSeconds: 7 }).message,
    ).toMatch(/7 segundos/);
  });

  it('network y server tienen mensajes distintos', () => {
    const red = checkoutBannerFor({ kind: 'network', message: 'x' });
    const server = checkoutBannerFor({ kind: 'server', message: 'x' });

    expect(red.message).not.toBe(server.message);
  });
});
