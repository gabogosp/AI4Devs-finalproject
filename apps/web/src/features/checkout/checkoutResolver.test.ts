import { describe, expect, it } from 'vitest';
import { checkoutResolver } from './checkoutResolver';

const opts = { criteriaMode: 'firstError', shouldUseNativeValidation: false } as const;

const valido = {
  buyer: { name: 'Ana Gómez', email: 'ana@example.com', phone: '+54 9 11 5555 5555' },
  consent: true as const,
  fulfillment: 'pickup' as const,
};

describe('checkoutResolver — sobre el schema generado (D3)', () => {
  it('valores válidos resuelven sin errores', async () => {
    const result = await checkoutResolver(valido, undefined, opts);

    expect(result.errors).toEqual({});
    expect(result.values).toEqual(valido);
  });

  it('un buyer.name de 1 carácter produce errors.buyer.name con el mensaje traducido', async () => {
    const result = await checkoutResolver(
      { ...valido, buyer: { ...valido.buyer, name: 'A' } },
      undefined,
      opts,
    );

    expect(result.errors.buyer?.name?.message).toMatch(/nombre/i);
  });

  it('consent: false produce errors.consent', async () => {
    const result = await checkoutResolver(
      // @ts-expect-error — consent inválido a propósito para probar el error
      { ...valido, consent: false },
      undefined,
      opts,
    );

    expect(result.errors.consent?.message).toMatch(/términos/i);
  });
});
