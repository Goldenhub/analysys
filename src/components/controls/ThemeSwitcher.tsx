import { useState, useEffect, useCallback } from 'react';
import { Sun, Moon, Monitor } from 'lucide-react';
import {
  applyThemePreference,
  getStoredThemePreference,
  watchSystemTheme,
  type ThemePreference,
} from '../../utils/theme';

const OPTIONS: { value: ThemePreference; icon: typeof Sun; label: string }[] = [
  { value: 'light', icon: Sun, label: 'Light' },
  { value: 'dark', icon: Moon, label: 'Dark' },
  { value: 'system', icon: Monitor, label: 'System' },
];

export function ThemeSwitcher() {
  const [pref, setPref] = useState<ThemePreference>(getStoredThemePreference);

  const handleChange = useCallback((next: ThemePreference) => {
    setPref(next);
    applyThemePreference(next);
  }, []);

  useEffect(() => {
    applyThemePreference(pref);
    const stop = watchSystemTheme(pref);
    return stop;
  }, [pref]);

  return (
    <div
      className="flex items-center gap-1 rounded-lg bg-gray-800 p-0.5"
      role="radiogroup"
      aria-label="Theme"
    >
      {OPTIONS.map(({ value, icon: Icon, label }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={pref === value}
          aria-label={label}
          onClick={() => handleChange(value)}
          className={`rounded-md p-1.5 transition-colors ${
            pref === value
              ? 'bg-gray-700 text-white shadow-sm'
              : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          <Icon className="h-4 w-4" />
        </button>
      ))}
    </div>
  );
}
