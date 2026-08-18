import { describe, expect, it } from 'vitest';
import {
  addDays,
  attachmentImageWidth,
  hasMarkdownImage,
  isoWeekForDate,
  setAttachmentImageWidth,
  stripMarkdownImages,
  todayInTimezone,
  weekRangeForDate,
  weeksInIsoYear
} from './lib';

describe('weekly date helpers', () => {
  it('handles ISO week-year boundaries', () => {
    expect(isoWeekForDate('2021-01-01')).toEqual({ year: 2020, week: 53 });
    expect(weeksInIsoYear(2020)).toBe(53);
  });
  it('returns a Monday to Sunday range', () => {
    expect(weekRangeForDate('2026-08-11')).toEqual({ weekStart: '2026-08-10', weekEnd: '2026-08-16' });
  });
  it('uses the selected timezone across an ISO week boundary', () => {
    const current = new Date('2026-01-04T23:30:00.000Z');
    expect(todayInTimezone('UTC', current)).toBe('2026-01-04');
    expect(todayInTimezone('Asia/Hong_Kong', current)).toBe('2026-01-05');
    expect(todayInTimezone('Asia/Shanghai', current)).toBe('2026-01-05');
  });
  it('falls back safely for an invalid timezone', () => {
    expect(todayInTimezone('Invalid/Timezone', new Date('2026-01-04T23:30:00.000Z'))).toBe('2026-01-05');
  });
  it('adds days across month boundaries', () => {
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
  });
  it('removes image markup from report summaries', () => {
    expect(stripMarkdownImages('完成登录。\n\n![示意图](/api/attachments/demo)')).toBe('完成登录。\n\n');
  });
  it('detects rendered images without treating ordinary links as images', () => {
    expect(hasMarkdownImage('![示意图](/api/attachments/demo)')).toBe(true);
    expect(hasMarkdownImage('<img src="/api/attachments/demo" alt="示意图">')).toBe(true);
    expect(hasMarkdownImage('[查看附件](/api/attachments/demo)')).toBe(false);
    expect(hasMarkdownImage('`![代码示例](/api/attachments/demo)`')).toBe(false);
    expect(hasMarkdownImage('```md\n![代码块示例](/api/attachments/demo)\n```')).toBe(false);
    expect(hasMarkdownImage('\\![转义示例](/api/attachments/demo)')).toBe(false);
    expect(hasMarkdownImage('`<img src="/api/attachments/demo">`')).toBe(false);
    expect(hasMarkdownImage('仅有文字')).toBe(false);
    expect(hasMarkdownImage('')).toBe(false);
  });
  it('persists a bounded display width in attachment image markup', () => {
    const content = '![示意图](/api/attachments/abc)';
    const resized = setAttachmentImageWidth(content, 'abc', 55);
    expect(resized).toBe('![示意图](/api/attachments/abc#w=55)');
    expect(attachmentImageWidth(resized, 'abc')).toBe(55);
    expect(attachmentImageWidth(content, 'abc')).toBe(70);
  });
});
