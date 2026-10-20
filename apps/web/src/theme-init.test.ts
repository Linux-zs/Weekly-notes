import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const bootstrap = readFileSync(new URL('../public/theme-init.js', import.meta.url), 'utf8');

describe('theme before application startup', () => {
  it.each([
    ['night', 12, 'night'],
    ['auto', 6, 'night'],
    ['auto', 7, 'ios-glass'],
    ['auto', 19, 'night'],
    ['paperline', 22, 'ios-glass']
  ])('restores %s at %s before the module executes', (saved, hour, expected) => {
    const root = { dataset: {} as Record<string, string>, style: { colorScheme: '' } };
    const meta = { content: '' };
    runInNewContext(bootstrap, {
      localStorage: { getItem: () => saved },
      Date: class {
        getHours() {
          return hour;
        }
      },
      document: { documentElement: root, querySelector: () => meta }
    });
    expect(root.dataset.theme).toBe(expected);
    expect(root.style.colorScheme).toBe(expected === 'night' ? 'dark' : 'light');
    expect(meta.content).toBe(expected === 'night' ? '#101722' : '#f3f9ff');
  });

  it('falls back when storage is blocked', () => {
    const root = { dataset: {} as Record<string, string>, style: {} };
    runInNewContext(bootstrap, {
      localStorage: {
        getItem: () => {
          throw new Error('blocked');
        }
      },
      document: { documentElement: root, querySelector: () => ({}) }
    });
    expect(root.dataset.theme).toBe('ios-glass');
  });
});
