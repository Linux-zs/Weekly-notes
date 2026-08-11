import { describe, expect, it } from 'vitest';
import { addDays, isoWeekForDate, weekRangeForDate, weeksInIsoYear } from './lib';

describe('weekly date helpers', () => {
  it('handles ISO week-year boundaries', () => {
    expect(isoWeekForDate('2021-01-01')).toEqual({ year: 2020, week: 53 });
    expect(weeksInIsoYear(2020)).toBe(53);
  });
  it('returns a Monday to Sunday range', () => {
    expect(weekRangeForDate('2026-08-11')).toEqual({ weekStart: '2026-08-10', weekEnd: '2026-08-16' });
  });
  it('adds days across month boundaries', () => {
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
  });
});
