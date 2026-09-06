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
    expect(avatarColor('cualquier-id')).toMatch(/^hsl\(\d+ 65% 55%\)$/);
  });

  it('ids distintos típicamente dan colores distintos', () => {
    expect(avatarColor('id-uno')).not.toBe(avatarColor('id-dos'));
  });
});
