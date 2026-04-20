import { useCallback, useEffect, useState } from "react";

export type Theme = "dark" | "light";

export const THEME_STORAGE_KEY = "agent-monitor-theme";

/**
 * Read the currently-applied theme from the DOM (set by the bootstrap
 * snippet in `index.html`) so we never flash the wrong palette.
 */
function readInitialTheme(): Theme {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.classList.contains("light") ? "light" : "dark";
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.classList.toggle("light", theme === "light");
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
  // Note: `meta[name="theme-color"]` is owned by the accent layer
  // (see hooks/useAccent.ts), which reacts to theme changes and writes
  // the correct hex for the active dark/light tone.
}

/**
 * Theme hook — persisted in localStorage and mirrored on the <html> element.
 * The DOM is the source of truth so multiple hook consumers stay in sync.
 */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(readInitialTheme);

  // Keep state in sync if another tab / other hook instance changes the theme.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== THEME_STORAGE_KEY) return;
      const next: Theme = e.newValue === "light" ? "light" : "dark";
      applyTheme(next);
      setThemeState(next);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setTheme = useCallback((next: Theme) => {
    applyTheme(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /* storage may be unavailable (private mode, etc.) */
    }
    setThemeState(next);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(readInitialTheme() === "light" ? "dark" : "light");
  }, [setTheme]);

  return { theme, setTheme, toggleTheme } as const;
}
