import { afterEach, describe, expect, it } from 'vitest';
import { saveOrderToken } from './orderToken';

afterEach(() => sessionStorage.clear());

describe('orderToken — sessionStorage, nunca la URL (D7)', () => {
  it('saveOrderToken escribe en sessionStorage bajo dsm_order_token', () => {
    saveOrderToken('a'.repeat(64));

    expect(sessionStorage.getItem('dsm_order_token')).toBe('a'.repeat(64));
  });
});
