import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadCsv } from './downloadCsv';

describe('downloadCsv', () => {
  let creados: string[];
  let revocados: string[];

  beforeEach(() => {
    creados = [];
    revocados = [];
    // jsdom no implementa object URLs, así que se parchean sólo los dos
    // métodos para poder afirmar el ciclo completo (crear → usar → revocar).
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: vi.fn(() => {
        const url = `blob:mock-${creados.length}`;
        creados.push(url);
        return url;
      }),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: vi.fn((url: string) => {
        revocados.push(url);
      }),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('crea un Blob, dispara el click con el nombre dado y revoca el object URL', () => {
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});

    downloadCsv('a,b\n1,2\n', 'reporte.csv');

    expect(click).toHaveBeenCalledTimes(1);
    const enlace = click.mock.instances[0] as unknown as HTMLAnchorElement;
    expect(enlace.download).toBe('reporte.csv');
    expect(creados).toHaveLength(1);
    expect(revocados).toEqual(creados);
  });

  it('revoca el object URL aunque el click falle', () => {
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
      throw new Error('boom');
    });

    expect(() => downloadCsv('a,b\n1,2\n', 'reporte.csv')).toThrow('boom');
    expect(revocados).toEqual(creados);
    expect(creados).toHaveLength(1);
  });
});
