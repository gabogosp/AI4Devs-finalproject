import { afterEach, describe, expect, it } from 'vitest';
import { CSRF_COOKIES, readCsrfToken } from './csrf';

/**
 * US-007 T0.4 — el segundo sujeto de CSRF.
 *
 * Va en un archivo aparte a propósito: `csrf.test.ts` es de US-014 y tiene que
 * seguir pasando **sin editarse**. Si hubiera que tocarlo, el comportamiento de
 * la sesión cambió y el refactor está mal.
 */
describe('readCsrfToken por sujeto', () => {
  afterEach(() => {
    document.cookie = 'dsm_csrf=; Max-Age=0; Path=/';
    document.cookie = 'dsm_cart_csrf=; Max-Age=0; Path=/';
  });

  it('el default sigue siendo la sesión (comportamiento de US-014 intacto)', () => {
    document.cookie = 'dsm_csrf=de-sesion; Path=/';
    document.cookie = 'dsm_cart_csrf=de-carrito; Path=/';

    expect(readCsrfToken()).toBe('de-sesion');
    expect(readCsrfToken('session')).toBe('de-sesion');
  });

  it("con ambas cookies, 'cart' lee dsm_cart_csrf y no la de sesión", () => {
    document.cookie = 'dsm_csrf=de-sesion; Path=/';
    document.cookie = 'dsm_cart_csrf=de-carrito; Path=/';

    expect(readCsrfToken('cart')).toBe('de-carrito');
  });

  it("sólo con la de sesión, 'cart' devuelve null (fail closed, no inventa)", () => {
    // Sin token de carrito la llamada sale sin header y el 403 se propaga.
    // Inventar un valor sólo cambiaría el 403 por un error más confuso.
    document.cookie = 'dsm_csrf=de-sesion; Path=/';

    expect(readCsrfToken('cart')).toBeNull();
  });

  it("sólo con la del carrito, 'session' devuelve null (los sujetos no se cruzan)", () => {
    // Es el caso del invitado: tiene carrito y no tiene cuenta.
    document.cookie = 'dsm_cart_csrf=de-carrito; Path=/';

    expect(readCsrfToken('session')).toBeNull();
    expect(readCsrfToken('cart')).toBe('de-carrito');
  });

  it('no confunde una cookie cuyo nombre CONTIENE el del carrito', () => {
    document.cookie = 'x_dsm_cart_csrf=valor-ajeno; Path=/';

    expect(readCsrfToken('cart')).toBeNull();
  });

  it('decodifica el valor del carrito', () => {
    document.cookie = `dsm_cart_csrf=${encodeURIComponent('a b+c')}; Path=/`;

    expect(readCsrfToken('cart')).toBe('a b+c');
  });

  it('el mapa de sujetos es exactamente sesión y carrito', () => {
    // Un sujeto nuevo es una decisión de diseño, no un detalle: que aparezca sin
    // que nadie lo note es cómo se termina con dos identidades sin dueño.
    expect(Object.keys(CSRF_COOKIES).sort()).toEqual(['cart', 'session']);
  });
});
