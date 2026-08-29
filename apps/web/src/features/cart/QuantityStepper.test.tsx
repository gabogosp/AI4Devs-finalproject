import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DEBOUNCE_MS, QuantityStepper } from './QuantityStepper';

/**
 * Sin fake timers a propósito.
 *
 * `vi.useFakeTimers()` cuelga a `userEvent`: falsea también `queueMicrotask`,
 * `performance` y `requestAnimationFrame`, y RTL espera promesas agendadas por
 * ahí, así que cada interacción se queda esperando hasta el timeout de la suite
 * (verificado: con el set completo y con `toFake` acotado, los 5 casos que
 * dependían del reloj timeouteaban a 5 s cada uno).
 *
 * En su lugar la ventana del debounce se **inyecta** y se espera con `waitFor`.
 * Es determinista —no depende de cuánto tarda la máquina— y prueba lo mismo: que
 * N clics producen UNA llamada con el valor final.
 *
 * La ventana debe ser **más larga que el intervalo real entre clics de userEvent**
 * en el runner más lento (CI): con 20 ms el debounce disparaba ENTRE clics en CI y
 * el test "cinco clics → una llamada" flakeaba (pasaba local, fallaba en Actions).
 * 250 ms da margen holgado sin alargar sensiblemente la suite (waitFor resuelve al
 * cerrarse la ventana tras el último clic).
 */
const VENTANA = 250;

function setup(props: Partial<Parameters<typeof QuantityStepper>[0]> = {}) {
  const onChange = vi.fn();
  const user = userEvent.setup();
  render(
    <QuantityStepper
      productName="Taco Fischer SX 8mm"
      quantity={1}
      maxQuantity={5}
      debounceMs={VENTANA}
      onChange={onChange}
      {...props}
    />,
  );
  return { onChange, user };
}

const sumar = () => screen.getByRole('button', { name: /sumar una unidad/i });
const restar = () => screen.getByRole('button', { name: /restar una unidad/i });

describe('QuantityStepper', () => {
  it('los aria-label NOMBRAN el producto (con varios steppers no se distinguen)', () => {
    setup();

    expect(sumar()).toHaveAccessibleName('Sumar una unidad de Taco Fischer SX 8mm');
    expect(restar()).toHaveAccessibleName('Restar una unidad de Taco Fischer SX 8mm');
    expect(
      screen.getByRole('spinbutton', { name: /cantidad de Taco Fischer SX 8mm/i }),
    ).toBeInTheDocument();
  });

  it('expone el tope como aria-valuemax (design-system §7.11)', () => {
    setup({ maxQuantity: 3 });

    const input = screen.getByRole('spinbutton');
    expect(input).toHaveAttribute('aria-valuemax', '3');
    expect(input).toHaveAttribute('aria-valuemin', '1');
  });

  it('en el tope, «+» queda deshabilitado', () => {
    setup({ quantity: 2, maxQuantity: 2 });

    expect(sumar()).toBeDisabled();
    expect(restar()).toBeEnabled();
  });

  it('en 1, «−» queda deshabilitado (bajar de 1 no es quitar)', () => {
    setup({ quantity: 1 });

    // El backend rechaza cantidad 0 a propósito: 0 no es una línea, es un DELETE.
    expect(restar()).toBeDisabled();
  });

  it('mientras la línea muta, los dos botones y el input quedan deshabilitados (pesimista)', () => {
    setup({ quantity: 2, mutating: true });

    expect(sumar()).toBeDisabled();
    expect(restar()).toBeDisabled();
    expect(screen.getByRole('spinbutton')).toBeDisabled();
  });

  it('el default del debounce es 400 ms (OQ-FE-1), no un valor de test', () => {
    expect(DEBOUNCE_MS).toBe(400);
  });

  it('cinco clics rápidos producen UNA sola llamada, con el valor final', async () => {
    const { onChange, user } = setup({ quantity: 1, maxQuantity: 9 });

    for (let i = 0; i < 5; i += 1) await user.click(sumar());

    // Sin debounce serían 5 escrituras y el rate-limit del backend se volvería
    // un 429 por impaciencia.
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(onChange).toHaveBeenCalledWith(6);
  });

  it('el debounce nunca pide más que el tope', async () => {
    const { onChange, user } = setup({ quantity: 1, maxQuantity: 3 });

    for (let i = 0; i < 8; i += 1) await user.click(sumar());

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(3));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('es operable con TECLADO: Tab hasta «+» y Enter', async () => {
    const { onChange, user } = setup({ quantity: 1, maxQuantity: 5 });

    // `−` está deshabilitado en 1, así que el primer Tab cae en el input.
    await user.tab();
    await user.tab();
    expect(sumar()).toHaveFocus();
    await user.keyboard('{Enter}');

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(2));
  });

  it('la flecha ↑ sobre el input suma', async () => {
    const { onChange, user } = setup({ quantity: 3, maxQuantity: 5 });

    await user.click(screen.getByRole('spinbutton'));
    await user.keyboard('{ArrowUp}');

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(4));
  });

  it('la flecha ↓ sobre el input resta', async () => {
    const { onChange, user } = setup({ quantity: 3, maxQuantity: 5 });

    await user.click(screen.getByRole('spinbutton'));
    await user.keyboard('{ArrowDown}');

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(2));
  });

  it('el valor pedido se sostiene hasta que el servidor contesta (pesimista)', async () => {
    // Dos ↑ seguidas sobre una cantidad de 3 piden 5, no 4: el stepper muestra lo
    // que la persona pidió hasta que llega el carrito nuevo, sin volver atrás solo.
    const { onChange, user } = setup({ quantity: 3, maxQuantity: 9 });

    await user.click(screen.getByRole('spinbutton'));
    await user.keyboard('{ArrowUp}{ArrowUp}');

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(5));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('no emite nada si el valor no cambia (flecha arriba estando en el tope)', async () => {
    const { onChange, user } = setup({ quantity: 5, maxQuantity: 5 });

    const input = screen.getByRole('spinbutton');
    await user.click(input);
    await user.keyboard('{ArrowUp}');

    // Se espera más que la ventana para que un falso negativo no pase por lento.
    await new Promise((r) => setTimeout(r, VENTANA * 3));
    expect(onChange).not.toHaveBeenCalled();
  });
});
