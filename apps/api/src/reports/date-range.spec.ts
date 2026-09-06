import { parseReportsRange } from './date-range';
import { ReportsInvalidRangeError } from './reports-errors';

const NOW = new Date('2026-09-05T12:00:00.000Z');
const RETENTION_MONTHS = 12;

describe('parseReportsRange', () => {
  it('sin created_at_from/created_at_to: to=now, from=now-30d', () => {
    const range = parseReportsRange({}, NOW, RETENTION_MONTHS);

    expect(range.to).toEqual(NOW);
    expect(range.from).toEqual(new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000));
  });

  it('con ambos dentro de la ventana de 12 meses: respeta los literales', () => {
    const range = parseReportsRange(
      { created_at_from: '2026-08-01T00:00:00.000Z', created_at_to: '2026-08-31T00:00:00.000Z' },
      NOW,
      RETENTION_MONTHS,
    );

    expect(range.from).toEqual(new Date('2026-08-01T00:00:00.000Z'));
    expect(range.to).toEqual(new Date('2026-08-31T00:00:00.000Z'));
  });

  it('con created_at_from anterior al piso de 12 meses: se acota al piso, sin lanzar', () => {
    const range = parseReportsRange(
      { created_at_from: '2020-01-01T00:00:00.000Z' },
      NOW,
      RETENTION_MONTHS,
    );

    const expectedFloor = new Date(NOW);
    expectedFloor.setMonth(expectedFloor.getMonth() - RETENTION_MONTHS);

    expect(range.from).toEqual(expectedFloor);
  });

  it('con created_at_from > created_at_to (ambos dentro de la ventana): lanza ReportsInvalidRangeError', () => {
    expect(() =>
      parseReportsRange(
        { created_at_from: '2026-08-31T00:00:00.000Z', created_at_to: '2026-08-01T00:00:00.000Z' },
        NOW,
        RETENTION_MONTHS,
      ),
    ).toThrow(ReportsInvalidRangeError);
  });
});
