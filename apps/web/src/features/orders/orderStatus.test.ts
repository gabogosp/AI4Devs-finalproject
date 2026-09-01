import { describe, expect, it } from 'vitest';
import type { FulfillmentStatus } from './ordersService';
import { ACTION_LABEL, NEXT_STATUS } from './orderStatus';

describe('orderStatus — FSM vista desde el FE (design.md §D4)', () => {
  const CASOS: Array<[FulfillmentStatus, FulfillmentStatus | null, string | undefined]> = [
    ['new', 'preparing', 'Marcar como preparando'],
    ['preparing', 'ready', 'Marcar como lista para retirar'],
    ['ready', 'delivered', 'Marcar como entregada'],
    ['delivered', null, undefined],
  ];

  it.each(CASOS)(
    '%s → NEXT_STATUS=%s, ACTION_LABEL[siguiente]=%s',
    (estado, siguienteEsperado, labelEsperado) => {
      expect(NEXT_STATUS[estado]).toBe(siguienteEsperado);
      // ACTION_LABEL está indexado por el estado DESTINO ("marcar como X"),
      // no por el actual — sin destino (terminal), no hay label que mostrar.
      const label = siguienteEsperado ? ACTION_LABEL[siguienteEsperado] : undefined;
      expect(label).toBe(labelEsperado);
    },
  );

  it('ningún valor mapea a cancelled (fuera de alcance de esta UI)', () => {
    const valores = Object.values(NEXT_STATUS);
    expect(valores).not.toContain('cancelled');
  });
});
