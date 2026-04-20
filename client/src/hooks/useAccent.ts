import { useCallback, useEffect, useState } from "react";
import {
  ACCENT_PRESETS,
  ACCENT_STORAGE_KEY,
  applyAccent,
  getAccentPreset,
  readStoredAccentId,
  writeStoredAccentId,
  type AccentPreset,
} from "../lib/accent";
import { useTheme } from "./useTheme";

/**
 * Accent-color hook. Persists the selected preset in localStorage, keeps CSS
 * variables in sync with the current theme (dark/light), and listens for
 * cross-tab changes via the `storage` event.
 */
export function useAccent() {
  const { theme } = useTheme();
  const [accentId, setAccentIdState] = useState<string>(() => readStoredAccentId());

  // Re-apply whenever the mode or selected preset changes, so the right
  // "tone" variant (dark vs light) is used.
  useEffect(() => {
    applyAccent(getAccentPreset(accentId), theme);
  }, [accentId, theme]);

  // Sync across tabs / windows.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== ACCENT_STORAGE_KEY) return;
      const next = e.newValue ?? undefined;
      setAccentIdState(getAccentPreset(next).id);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setAccentId = useCallback((id: string) => {
    const preset = getAccentPreset(id);
    writeStoredAccentId(preset.id);
    setAccentIdState(preset.id);
  }, []);

  const accent: AccentPreset = getAccentPreset(accentId);

  return { accent, accentId: accent.id, setAccentId, presets: ACCENT_PRESETS } as const;
}
