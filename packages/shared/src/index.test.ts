import { describe, expect, it } from 'vitest';
import { reportItemInputSchema } from './index.js';

describe('report item input', () => {
  it('accepts persisted progress and notes', () => {
    expect(
      reportItemInputSchema.parse({
        type: 'other',
        contentMd: '补充事项',
        progress: 'answered',
        note: '领导已确认'
      })
    ).toMatchObject({ progress: 'answered', note: '领导已确认' });
  });
  it('rejects unsupported progress values', () => {
    expect(() =>
      reportItemInputSchema.parse({ type: 'other', contentMd: '补充事项', progress: 'unknown' })
    ).toThrow();
  });
  it('rejects the removed risk type', () => {
    expect(() => reportItemInputSchema.parse({ type: 'risk', contentMd: '阻塞事项' })).toThrow();
  });
  it('rejects duplicate tags and more than the shared tag limit', () => {
    const tag = '11111111-1111-4111-8111-111111111111';
    expect(
      reportItemInputSchema.safeParse({ type: 'completed', contentMd: '', tagIds: [tag, tag] }).success
    ).toBe(false);
    expect(
      reportItemInputSchema.safeParse({
        type: 'completed',
        contentMd: '',
        tagIds: Array.from(
          { length: 21 },
          (_, index) => `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`
        )
      }).success
    ).toBe(false);
  });
});
