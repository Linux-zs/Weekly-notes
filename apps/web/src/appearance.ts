export const UI_THEME_STORAGE_KEY = 'weekly-report:theme';
export const uiThemes = ['paperline', 'ios-glass'] as const;
export type UiTheme = (typeof uiThemes)[number];

type ThemeStorage = Pick<Storage, 'getItem' | 'setItem'>;
type ThemeRoot = Pick<HTMLElement, 'dataset'>;

function browserStorage(): ThemeStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function normalizeUiTheme(value: string | null | undefined): UiTheme {
  return value === 'ios-glass' ? 'ios-glass' : 'paperline';
}

export function readUiTheme(storage: ThemeStorage | null = browserStorage()): UiTheme {
  try {
    return normalizeUiTheme(storage?.getItem(UI_THEME_STORAGE_KEY));
  } catch {
    return 'paperline';
  }
}

export function applyUiTheme(theme: UiTheme, root: ThemeRoot = document.documentElement) {
  root.dataset.theme = theme;
}

export function saveUiTheme(
  theme: UiTheme,
  storage: ThemeStorage | null = browserStorage(),
  root: ThemeRoot = document.documentElement
) {
  applyUiTheme(theme, root);
  try {
    storage?.setItem(UI_THEME_STORAGE_KEY, theme);
  } catch {
    // The active theme still applies for this session when browser storage is unavailable.
  }
}

export function initializeUiTheme(
  storage: ThemeStorage | null = browserStorage(),
  root: ThemeRoot = document.documentElement
) {
  const theme = readUiTheme(storage);
  applyUiTheme(theme, root);
  return theme;
}
