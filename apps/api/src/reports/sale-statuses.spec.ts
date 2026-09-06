import { SALE_STATUSES } from './sale-statuses';

describe('SALE_STATUSES', () => {
  it('contiene exactamente los 4 estados activos, sin pending_payment ni cancelled', () => {
    expect(SALE_STATUSES).toEqual(['new', 'preparing', 'ready', 'delivered']);
    expect(SALE_STATUSES).not.toContain('pending_payment');
    expect(SALE_STATUSES).not.toContain('cancelled');
    expect(SALE_STATUSES).toHaveLength(4);
  });
});
