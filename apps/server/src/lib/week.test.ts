import { describe, expect, it } from 'vitest';
import { isoWeekForDate, isoWeekRange } from './week.js';

describe('ISO week helpers', () => {
  it('handles the ISO week year boundary', () => {
    expect(isoWeekForDate('2021-01-01')).toEqual({ weekYear: 2020, weekNumber: 53 });
    expect(isoWeekRange(2020, 53)).toEqual({ weekStart: '2020-12-28', weekEnd: '2021-01-03' });
  });
  it('returns a Monday to Sunday range', () => {
    expect(isoWeekRange(2026, 33)).toEqual({ weekStart: '2026-08-10', weekEnd: '2026-08-16' });
  });
});
