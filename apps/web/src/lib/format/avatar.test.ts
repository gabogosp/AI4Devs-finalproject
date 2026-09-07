import { describe, expect, it } from 'vitest';
import { avatarColor, initialsFrom } from './avatar';

describe('initialsFrom', () => {
  it('nombre de una palabra → una letra', () => {
    expect(initialsFrom('Ana')).toBe('A');
  });

  it('nombre de dos palabras → primera + última inicial', () => {
    expect(initialsFrom('Ana María Pérez')).toBe('AP');
  });

  it('espacios extra no rompen el resultado', () => {
    expect(initialsFrom('  Ana   María  ')).toBe('AM');
  });

  it('nombre vacío → cadena vacía, no lanza', () => {
    expect(initialsFrom('   ')).toBe('');
  });
});

describe('avatarColor', () => {
  it('el mismo id da el mismo color en llamadas repetidas', () => {
    const id = 'a1b2c3d4-1111-2222-3333-444455556666';
    expect(avatarColor(id)).toBe(avatarColor(id));
  });

  it('devuelve un hsl válido', () => {
    expect(avatarColor('cualquier-id')).toMatch(/^hsl\(\d+ 65% 25%\)$/);
  });

  it('ids distintos típicamente dan colores distintos', () => {
    expect(avatarColor('id-uno')).not.toBe(avatarColor('id-dos'));
  });

  /**
   * Regresión: a `lightness: 55%` (valor original) el peor hue (amarillo,
   * ~60°) daba 1.54:1 de contraste contra el texto blanco de las iniciales —
   * muy por debajo del 3:1 mínimo de WCAG AA para texto grande, y el avatar
   * `sm`/`md` ni siquiera es "texto grande" (exige 4.5:1). Se prueban los
   * 360 hues posibles, no sólo uno, porque el hash del id puede caer en
   * cualquiera.
   */
  it('el contraste contra texto blanco cumple WCAG AA (4.5:1) para cualquier hue', () => {
    function hslToRgb(h: number, s: number, l: number): [number, number, number] {
      s /= 100;
      l /= 100;
      const k = (n: number) => (n + h / 30) % 12;
      const a = s * Math.min(l, 1 - l);
      const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
      return [f(0), f(8), f(4)];
    }
    function relativeLuminance([r, g, b]: [number, number, number]): number {
      const chan = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
      const [R, G, B] = [r, g, b].map(chan);
      return 0.2126 * R + 0.7152 * G + 0.0722 * B;
    }
    const WHITE_LUMINANCE = 1;
    for (let hue = 0; hue < 360; hue += 5) {
      const contraste = (WHITE_LUMINANCE + 0.05) / (relativeLuminance(hslToRgb(hue, 65, 25)) + 0.05);
      expect(contraste, `hue=${hue}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
