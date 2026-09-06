import { describe, expect, it } from 'vitest';
import { filenameFromContentDisposition } from './contentDisposition';

describe('filenameFromContentDisposition', () => {
  it('lee el filename con comillas', () => {
    const headers = new Headers({
      'content-disposition': 'attachment; filename="reporte.csv"',
    });

    expect(filenameFromContentDisposition(headers, 'respaldo.csv')).toBe(
      'reporte.csv',
    );
  });

  it('lee el filename sin comillas', () => {
    const headers = new Headers({
      'content-disposition': 'attachment; filename=reporte.csv',
    });

    expect(filenameFromContentDisposition(headers, 'respaldo.csv')).toBe(
      'reporte.csv',
    );
  });

  it('usa el fallback si el header no está presente', () => {
    const headers = new Headers();

    expect(filenameFromContentDisposition(headers, 'respaldo.csv')).toBe(
      'respaldo.csv',
    );
  });
});
