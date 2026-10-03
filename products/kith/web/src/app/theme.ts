export type ThemePref = "system" | "light" | "dark";
export const THEME_STORAGE_KEY = "kith.theme";

export function readTheme(): ThemePref {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    if (value === "system" || value === "light" || value === "dark") return value;
  } catch {
    // localStorage unavailable: follow the system theme.
  }
  return "system";
}

export function applyTheme(pref: ThemePref): void {
  if (pref === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = pref;
}

export function saveTheme(pref: ThemePref): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, pref);
  } catch {
    // the choice still applies to this page
  }
  applyTheme(pref);
}
