// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  applyUiTheme,
  initializeUiTheme,
  normalizeUiTheme,
  readUiTheme,
  saveUiTheme,
  resolveUiTheme,
  watchUiTheme,
  UI_THEME_STORAGE_KEY
} from './appearance';

function root() {
  return { dataset: {} as DOMStringMap };
}

describe('UI theme preference', () => {
  it('updates browser chrome and only schedules automatic theme boundaries', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 19, 18));
    const meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.append(meta);
    initializeUiTheme({ getItem: () => 'night', setItem: vi.fn() });
    const stop = watchUiTheme();
    try {
      expect(meta.content).toBe('#101722');
      expect(vi.getTimerCount()).toBe(0);
      saveUiTheme('auto', null);
      expect(vi.getTimerCount()).toBe(1);
      expect(meta.content).toBe('#f3f9ff');
      vi.advanceTimersByTime(60 * 60 * 1000);
      expect(meta.content).toBe('#101722');
      expect(vi.getTimerCount()).toBe(1);
      saveUiTheme('ios-glass', null);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      stop();
      meta.remove();
      vi.useRealTimers();
    }
  });
  it.each([
    [6, 59, 'night'],
    [7, 0, 'ios-glass'],
    [18, 59, 'ios-glass'],
    [19, 0, 'night'],
    [0, 0, 'night']
  ] as const)('resolves local time %s:%s to %s', (hour, minute, expected) => {
    expect(resolveUiTheme('auto', new Date(2026, 9, 19, hour, minute))).toBe(expected);
    expect(resolveUiTheme('night', new Date(2026, 9, 19, hour, minute))).toBe('night');
  });

  it('switches an open page at the boundary and refreshes after wake without overwriting auto', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 19, 18, 59, 59));
    const storage = { getItem: vi.fn(() => 'auto'), setItem: vi.fn() };
    initializeUiTheme(storage);
    const stop = watchUiTheme();
    try {
      expect(document.documentElement.dataset.theme).toBe('ios-glass');
      vi.advanceTimersByTime(1000);
      expect(document.documentElement.dataset.theme).toBe('night');
      expect(document.documentElement.dataset.themePreference).toBe('auto');
      vi.setSystemTime(new Date(2026, 9, 20, 8));
      window.dispatchEvent(new Event('focus'));
      expect(document.documentElement.dataset.theme).toBe('ios-glass');
      saveUiTheme('night', storage);
      vi.advanceTimersByTime(1000);
      expect(document.documentElement.dataset.theme).toBe('night');
    } finally {
      stop();
      vi.useRealTimers();
    }
  });
  it('defaults invalid or missing values to iOS glass', () => {
    expect(normalizeUiTheme(null)).toBe('ios-glass');
    expect(normalizeUiTheme('unknown')).toBe('ios-glass');
    expect(normalizeUiTheme('paperline')).toBe('ios-glass');
    expect(normalizeUiTheme('ios-glass')).toBe('ios-glass');
  });

  it('reads and initializes a persisted iOS glass theme before rendering', () => {
    const storage = { getItem: vi.fn(() => 'ios-glass'), setItem: vi.fn() };
    const documentRoot = root();
    expect(initializeUiTheme(storage, documentRoot)).toBe('ios-glass');
    expect(storage.getItem).toHaveBeenCalledWith(UI_THEME_STORAGE_KEY);
    expect(documentRoot.dataset.theme).toBe('ios-glass');
  });

  it('falls back safely when browser storage cannot be read', () => {
    const storage = {
      getItem: vi.fn(() => {
        throw new Error('blocked');
      }),
      setItem: vi.fn()
    };
    expect(readUiTheme(storage)).toBe('ios-glass');
  });

  it('applies a theme even when persisting it fails', () => {
    const storage = {
      getItem: vi.fn(),
      setItem: vi.fn(() => {
        throw new Error('blocked');
      })
    };
    const documentRoot = root();
    expect(() => saveUiTheme('ios-glass', storage, documentRoot)).not.toThrow();
    expect(documentRoot.dataset.theme).toBe('ios-glass');
  });

  it('applies a valid theme directly to the root element', () => {
    const documentRoot = root();
    applyUiTheme('ios-glass', documentRoot);
    expect(documentRoot.dataset.theme).toBe('ios-glass');
  });
});
