import { canTransition } from './order-state';

describe('order-state — FSM de fulfillment (4 estados activos)', () => {
  it('permite el paso siguiente válido', () => {
    expect(canTransition('new', 'preparing')).toBe(true);
    expect(canTransition('preparing', 'ready')).toBe(true);
    expect(canTransition('ready', 'delivered')).toBe(true);
  });

  it('rechaza un salto de dos pasos', () => {
    expect(canTransition('new', 'delivered')).toBe(false);
  });

  it('delivered es terminal', () => {
    expect(canTransition('delivered', 'preparing')).toBe(false);
  });

  it('pending_payment → new queda fuera de esta FSM (lo decide payments/ de US-023)', () => {
    expect(canTransition('pending_payment', 'new')).toBe(false);
  });
});
