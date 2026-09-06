import { describe, expect, it } from 'vitest';
import { formatPeriod } from './formatPeriod';

describe('formatPeriod', () => {
  it('day: DD/MM', () => {
    expect(formatPeriod('2026-08-01', 'day')).toBe('01/08');
  });

  it('week: "semana del DD/MM"', () => {
    expect(formatPeriod('2026-08-03', 'week')).toBe('semana del 03/08');
  });

  it('month: MMM AAAA', () => {
    expect(formatPeriod('2026-08-01', 'month')).toBe('ago 2026');
  });
});
