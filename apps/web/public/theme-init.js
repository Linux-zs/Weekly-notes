/* global localStorage, document */
// Runs before styles and the application bundle, including under script-src 'self'.
(() => {
  let preference = 'ios-glass';
  try {
    const saved = localStorage.getItem('weekly-report:theme');
    if (saved === 'night' || saved === 'auto') preference = saved;
  } catch {
    // Storage can be unavailable in private or embedded browsing contexts.
  }
  const hour = new Date().getHours();
  const theme = preference === 'auto' ? (hour >= 7 && hour < 19 ? 'ios-glass' : 'night') : preference;
  document.documentElement.dataset.themePreference = preference;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme === 'night' ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]').content = theme === 'night' ? '#101722' : '#f3f9ff';
})();
