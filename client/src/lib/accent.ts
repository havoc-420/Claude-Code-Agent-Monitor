/**
 * Accent color presets.
 *
 * The app's "brand" color (used for the `accent` Tailwind token, `ring-accent`,
 * selection highlight, favicon theme-color, etc.) is driven by CSS variables
 * `--accent` / `--accent-hover` / `--selection-bg`, defined as "R G B" triplets
 * so Tailwind can keep applying `/alpha` modifiers like `bg-accent/20`.
 *
 * Each preset ships two tones:
 *   - `dark`:  bright/saturated, readable on the dark theme
 *   - `light`: slightly deeper, readable against white surfaces
 * plus matching hover variants.
 *
 * The selected preset id is persisted in localStorage and applied once
 * before first paint by the bootstrap script in `index.html`, and thereafter
 * by `applyAccent()` below. Inline `style.setProperty(...)` on
 * `document.documentElement` overrides the values in `index.css`, which
 * means the same preset works for both dark and light modes.
 */

export interface AccentTone {
  /** Base accent "R G B" triplet. */
  base: string;
  /** Hover/highlight accent "R G B" triplet. */
  hover: string;
  /** Hex value used for <meta name="theme-color">. */
  themeColor: string;
}

export interface AccentPreset {
  id: string;
  label: string;
  /** A visible swatch color for the picker UI (hex). */
  swatch: string;
  dark: AccentTone;
  light: AccentTone;
}

/**
 * Preset list. The first entry is the default.
 *
 * Colors are drawn from Tailwind's standard palette so they blend in nicely
 * with status colors (emerald/red/amber/…) already used across the UI.
 */
export const ACCENT_PRESETS: AccentPreset[] = [
  {
    id: "emerald",
    label: "Emerald",
    swatch: "#10b981",
    dark: { base: "16 185 129", hover: "52 211 153", themeColor: "#10b981" },
    light: { base: "5 150 105", hover: "4 120 87", themeColor: "#059669" },
  },
  {
    id: "teal",
    label: "Teal",
    swatch: "#14b8a6",
    dark: { base: "20 184 166", hover: "45 212 191", themeColor: "#14b8a6" },
    light: { base: "13 148 136", hover: "15 118 110", themeColor: "#0d9488" },
  },
  {
    id: "sky",
    label: "Sky",
    swatch: "#0ea5e9",
    dark: { base: "14 165 233", hover: "56 189 248", themeColor: "#0ea5e9" },
    light: { base: "2 132 199", hover: "3 105 161", themeColor: "#0284c7" },
  },
  {
    id: "indigo",
    label: "Indigo",
    swatch: "#6366f1",
    dark: { base: "99 102 241", hover: "129 140 248", themeColor: "#6366f1" },
    light: { base: "79 70 229", hover: "67 56 202", themeColor: "#4f46e5" },
  },
  {
    id: "violet",
    label: "Violet",
    swatch: "#8b5cf6",
    dark: { base: "139 92 246", hover: "167 139 250", themeColor: "#8b5cf6" },
    light: { base: "124 58 237", hover: "109 40 217", themeColor: "#7c3aed" },
  },
  {
    id: "rose",
    label: "Rose",
    swatch: "#f43f5e",
    dark: { base: "244 63 94", hover: "251 113 133", themeColor: "#f43f5e" },
    light: { base: "225 29 72", hover: "190 18 60", themeColor: "#e11d48" },
  },
  {
    id: "amber",
    label: "Amber",
    swatch: "#f59e0b",
    dark: { base: "245 158 11", hover: "251 191 36", themeColor: "#f59e0b" },
    light: { base: "217 119 6", hover: "180 83 9", themeColor: "#d97706" },
  },
];

export const ACCENT_STORAGE_KEY = "agent-monitor-accent";
export const DEFAULT_ACCENT_ID = "emerald";

export function getAccentPreset(id: string | null | undefined): AccentPreset {
  return ACCENT_PRESETS.find((p) => p.id === id) ?? ACCENT_PRESETS[0];
}

/**
 * Apply the preset to the document. Safe to call on every change — the DOM
 * writes are cheap and synchronous.
 *
 * @param theme  The currently active theme (so we pick the matching tone).
 */
export function applyAccent(preset: AccentPreset, theme: "dark" | "light"): void {
  if (typeof document === "undefined") return;
  const tone = theme === "light" ? preset.light : preset.dark;
  const root = document.documentElement;

  // Inline style overrides any `.dark` / `.light` rule in index.css.
  root.style.setProperty("--accent", tone.base);
  root.style.setProperty("--accent-hover", tone.hover);
  root.style.setProperty("--selection-bg", tone.base);

  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = tone.themeColor;
}

/** Read the persisted accent id (or the default). */
export function readStoredAccentId(): string {
  if (typeof localStorage === "undefined") return DEFAULT_ACCENT_ID;
  try {
    return localStorage.getItem(ACCENT_STORAGE_KEY) ?? DEFAULT_ACCENT_ID;
  } catch {
    return DEFAULT_ACCENT_ID;
  }
}

export function writeStoredAccentId(id: string): void {
  try {
    localStorage.setItem(ACCENT_STORAGE_KEY, id);
  } catch {
    /* localStorage may be blocked (private mode) — ignore. */
  }
}
