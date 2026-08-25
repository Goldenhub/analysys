// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { applyThemePreference, getStoredThemePreference, watchSystemTheme } from './theme';

function stubMatchMedia(dark: boolean): { cleanup: () => void; setDark: (d: boolean) => void } {
  let isDark = dark;
  const listeners = new Set<() => void>();
  const mq = {
    matches: isDark,
    addEventListener: (_: string, cb: () => void) => listeners.add(cb),
    removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
  };
  vi.stubGlobal('matchMedia', (query: string) => {
    expect(query).toBe('(prefers-color-scheme: dark)');
    return mq;
  });
  return {
    cleanup: () => vi.unstubAllGlobals(),
    setDark: (d: boolean) => {
      isDark = d;
      mq.matches = d;
      listeners.forEach((cb) => cb());
    },
  };
}

describe('theme preferences', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = '';
  });

  it('defaults to dark with nothing stored', () => {
    expect(getStoredThemePreference()).toBe('dark');
  });

  it('applies theme-light only for light or system+light-OS', () => {
    const media = stubMatchMedia(true); // OS dark
    applyThemePreference('light');
    expect(document.documentElement.classList.contains('theme-light')).toBe(true);

    applyThemePreference('dark');
    expect(document.documentElement.classList.contains('theme-light')).toBe(false);

    applyThemePreference('system');
    expect(document.documentElement.classList.contains('theme-light')).toBe(false);

    // Register the system listener so OS changes propagate reactively
    const stop = watchSystemTheme('system');
    media.setDark(false); // OS flips to light while on `system`
    expect(document.documentElement.classList.contains('theme-light')).toBe(true);
    stop();
    media.cleanup();
  });

  it('persists the choice and reads it back', () => {
    applyThemePreference('system');
    expect(getStoredThemePreference()).toBe('system');
  });

  it('mirrors color-scheme for native controls', () => {
    applyThemePreference('light');
    expect(document.documentElement.style.colorScheme).toBe('light');
    applyThemePreference('dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');
  });

  it('watchSystemTheme only subscribes on system preference', () => {
    const media = stubMatchMedia(true);
    const stop1 = watchSystemTheme('dark');
    // No crash, but no live updates either — dark ignores the OS.
    expect(typeof stop1).toBe('function');

    const stop2 = watchSystemTheme('system');
    media.setDark(false);
    expect(document.documentElement.classList.contains('theme-light')).toBe(true);
    stop2();
    media.cleanup();
  });
});
