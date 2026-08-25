export type ThemePreference = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'analysys-theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

/** Read the persisted preference, defaulting to dark (the app's original look). */
export function getStoredThemePreference(): ThemePreference {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === 'light' || raw === 'dark' || raw === 'system') return raw;
  } catch {
    /* storage unavailable — fall through */
  }
  return 'dark';
}

function systemPrefersDark(): boolean {
  return typeof matchMedia === 'function' && matchMedia(DARK_QUERY).matches;
}

/**
 * Apply a preference to <html>: adds/removes `theme-light` (the absence of it
 * is the dark theme) and mirrors the resolved scheme to `color-scheme` so
 * native form controls follow along.
 */
export function applyThemePreference(pref: ThemePreference): void {
  const root = document.documentElement;
  const light = pref === 'light' || (pref === 'system' && !systemPrefersDark());
  root.classList.toggle('theme-light', light);
  root.style.colorScheme = light ? 'light' : 'dark';
  try {
    localStorage.setItem(STORAGE_KEY, pref);
  } catch {
    /* ignore */
  }
}

/**
 * Re-apply whenever the OS scheme changes while on `system`.
 * Returns a cleanup function.
 */
export function watchSystemTheme(pref: ThemePreference): () => void {
  if (pref !== 'system' || typeof matchMedia !== 'function') return () => {};
  const mq = matchMedia(DARK_QUERY);
  const handler = () => applyThemePreference('system');
  mq.addEventListener('change', handler);
  return () => mq.removeEventListener('change', handler);
}
