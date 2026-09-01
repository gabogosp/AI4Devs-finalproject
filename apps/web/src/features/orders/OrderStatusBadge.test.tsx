import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OrderStatusBadge } from './OrderStatusBadge';
import type { OrderStatus } from './ordersService';

describe('OrderStatusBadge (T3.1, design-system §7.7)', () => {
  const CASOS: Array<[OrderStatus, string]> = [
    ['new', 'Nueva'],
    ['preparing', 'Preparando'],
    ['ready', 'Lista para retirar'],
    ['delivered', 'Entregada'],
    ['cancelled', 'Cancelada'],
  ];

  it.each(CASOS)('%s renderiza el texto "%s"', (status, textoEsperado) => {
    render(<OrderStatusBadge status={status} />);
    expect(screen.getByText(textoEsperado)).toBeInTheDocument();
  });

  it('los 5 estados producen 5 textos distintos (nunca sólo color)', () => {
    const textos = CASOS.map(([status]) => {
      const { unmount, container } = render(<OrderStatusBadge status={status} />);
      const texto = container.textContent;
      unmount();
      return texto;
    });
    expect(new Set(textos).size).toBe(5);
  });

  it('preparing y ready comparten clase de color pero difieren en texto', () => {
    const { container: preparando } = render(<OrderStatusBadge status="preparing" />);
    const { container: lista } = render(<OrderStatusBadge status="ready" />);

    const claseDe = (c: HTMLElement) => c.querySelector('span')?.className;
    expect(claseDe(preparando)).toBe(claseDe(lista));
    expect(preparando.textContent).not.toBe(lista.textContent);
  });
});
