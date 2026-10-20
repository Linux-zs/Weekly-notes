export const UI_THEME_STORAGE_KEY = 'weekly-report:theme';
export const uiThemes = ['ios-glass', 'night', 'auto'] as const;
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
  return value === 'night' || value === 'auto' ? value : 'ios-glass';
}

export function readUiTheme(storage: ThemeStorage | null = browserStorage()): UiTheme {
  try {
    return normalizeUiTheme(storage?.getItem(UI_THEME_STORAGE_KEY));
  } catch {
    return 'ios-glass';
  }
}

export function resolveUiTheme(theme: UiTheme, now = new Date()): 'ios-glass' | 'night' {
  return theme === 'auto' ? (now.getHours() >= 7 && now.getHours() < 19 ? 'ios-glass' : 'night') : theme;
}

export function applyUiTheme(theme: UiTheme, root: ThemeRoot = document.documentElement) {
  if (root.dataset.themePreference !== theme) root.dataset.themePreference = theme;
  const resolved = resolveUiTheme(theme);
  if (root.dataset.theme !== resolved) root.dataset.theme = resolved;
  if (root === document.documentElement) {
    document.documentElement.style.colorScheme = resolved === 'night' ? 'dark' : 'light';
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', resolved === 'night' ? '#101722' : '#f3f9ff');
  }
}

export function saveUiTheme(
  theme: UiTheme,
  storage: ThemeStorage | null = browserStorage(),
  root: ThemeRoot = document.documentElement
) {
  applyUiTheme(theme, root);
  if (root === document.documentElement) window.dispatchEvent(new Event('ui-theme-change'));
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

// Keep the in-memory preference when storage is blocked; recheck on wake and across tabs.
export function watchUiTheme() {
  let timer: number | undefined;
  const refresh = () => {
    window.clearTimeout(timer);
    const preference = normalizeUiTheme(document.documentElement.dataset.themePreference);
    applyUiTheme(preference);
    if (preference !== 'auto') return;
    const now = new Date();
    const next = new Date(now);
    if (now.getHours() < 7) next.setHours(7, 0, 0, 0);
    else if (now.getHours() < 19) next.setHours(19, 0, 0, 0);
    else {
      next.setDate(next.getDate() + 1);
      next.setHours(7, 0, 0, 0);
    }
    timer = window.setTimeout(refresh, next.getTime() - now.getTime());
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key === UI_THEME_STORAGE_KEY || event.key === null) {
      applyUiTheme(readUiTheme());
      refresh();
    }
  };
  refresh();
  window.addEventListener('ui-theme-change', refresh);
  window.addEventListener('focus', refresh);
  document.addEventListener('visibilitychange', refresh);
  window.addEventListener('storage', onStorage);
  return () => {
    window.clearTimeout(timer);
    window.removeEventListener('ui-theme-change', refresh);
    window.removeEventListener('focus', refresh);
    document.removeEventListener('visibilitychange', refresh);
    window.removeEventListener('storage', onStorage);
  };
}
