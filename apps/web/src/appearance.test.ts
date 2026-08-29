import { describe, expect, it, vi } from 'vitest';
import {
  applyUiTheme,
  initializeUiTheme,
  normalizeUiTheme,
  readUiTheme,
  saveUiTheme,
  UI_THEME_STORAGE_KEY
} from './appearance';

function root() {
  return { dataset: {} as DOMStringMap };
}

describe('UI theme preference', () => {
  it('defaults invalid or missing values to Paperline', () => {
    expect(normalizeUiTheme(null)).toBe('paperline');
    expect(normalizeUiTheme('unknown')).toBe('paperline');
    expect(normalizeUiTheme('paperline')).toBe('paperline');
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
    expect(readUiTheme(storage)).toBe('paperline');
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
    applyUiTheme('paperline', documentRoot);
    expect(documentRoot.dataset.theme).toBe('paperline');
  });
});
