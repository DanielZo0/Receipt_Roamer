export type Theme = "light" | "dark" | "system";

export const THEME_STORAGE_KEY = "receipt-roamer-theme";

function isTheme(value: string | null): value is Theme {
  return value === "light" || value === "dark" || value === "system";
}

/** Reads the user's stored theme preference, defaulting to "system" if
 *  nothing (or something invalid) is stored, or if reading fails.
 *  Safe to call during SSR. */
export function getStoredTheme(): Theme {
  if (typeof window === "undefined") return "system";
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(value) ? value : "system";
  } catch {
    return "system";
  }
}

/** Persists the user's theme preference. Safe to call during SSR, and
 *  silently no-ops if storage is unavailable or throws. */
export function setStoredTheme(theme: Theme): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Ignore — persisting the theme choice is best-effort.
  }
}

/** Resolves a theme preference to an actual light/dark value, given whether
 *  the OS/browser currently prefers dark mode. */
export function resolveTheme(theme: Theme, prefersDark: boolean): "light" | "dark" {
  if (theme === "system") return prefersDark ? "dark" : "light";
  return theme;
}
