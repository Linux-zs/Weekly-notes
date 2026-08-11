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
});
