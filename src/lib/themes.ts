// ─── Curated theme presets ──────────────────────────────────────────────────
// Four hand-tuned color + font palettes. Admin picks one — every color is
// already harmonized. No individual color pickers anywhere in the UI.

export type ThemeId = "onyx" | "velvet" | "vintage" | "mono" | "teal";

export type Theme = {
  id: ThemeId;
  name: string;        // Hebrew label shown in admin
  description: string; // Hebrew sub-label
  isDark: boolean;

  // ── Surface colors ──
  bg: string;          // main page background
  bgAlt: string;       // alternating section background
  card: string;        // card / panel background
  headerBg: string;    // sticky header rgba (with alpha for blur)

  // ── Brand & text ──
  brand: string;       // primary accent (CTAs, headlines, dots)
  brandSoft: string;   // softer variant for gradients/rings
  textPri: string;     // headlines / primary text
  textSec: string;     // body / secondary text
  textMuted: string;   // captions / labels
  divider: string;     // border lines (rgba)

  // ── Fonts (CSS variables loaded in layout.tsx) ──
  fontDisplay: string; // var(--font-...) for headings
  fontBody: string;    // var(--font-...) for body
};

// Hex → "r,g,b" helper (so we can write `rgba(${rgb(brand)},0.18)` in styles)
export function hexToRgb(hex: string): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `${r},${g},${b}`;
}

export const THEMES: Record<ThemeId, Theme> = {
  // ─── 1. Onyx — Black & Gold (refined version of current dark) ──
  onyx: {
    id: "onyx",
    name: "Onyx",
    description: "שחור פרימיום · זהב חם",
    isDark: true,
    bg:        "#0A0A0A",
    bgAlt:     "#141414",
    card:      "#1A1A1A",
    headerBg:  "rgba(10,10,10,0.85)",
    brand:     "#D4AF37",
    brandSoft: "#A87C2A",
    textPri:   "#F5F0E1",
    textSec:   "#A8A099",
    textMuted: "#6B6359",
    divider:   "rgba(212,175,55,0.18)",
    fontDisplay: "var(--font-frank)",
    fontBody:    "var(--font-heebo)",
  },

  // ─── 2. Velvet — Deep wine + champagne (luxury evening) ──
  velvet: {
    id: "velvet",
    name: "Velvet",
    description: "יין עמוק · שמפניה",
    isDark: true,
    bg:        "#1A0E12",
    bgAlt:     "#2A1820",
    card:      "#38242B",
    headerBg:  "rgba(26,14,18,0.85)",
    brand:     "#D4A574",
    brandSoft: "#9C7449",
    textPri:   "#F5E8D8",
    textSec:   "#B8A89A",
    textMuted: "#7A6A5C",
    divider:   "rgba(212,165,116,0.20)",
    fontDisplay: "var(--font-bellefair)",
    fontBody:    "var(--font-frank)",
  },

  // ─── 3. Vintage — Cream + brick (classic old-school barber, light) ──
  vintage: {
    id: "vintage",
    name: "Vintage",
    description: "ספר ויניטג' · קרם וקלאסי",
    isDark: false,
    bg:        "#F4EDDF",
    bgAlt:     "#EAE0CC",
    card:      "#FFFFFF",
    headerBg:  "rgba(244,237,223,0.92)",
    brand:     "#8B2E1F",
    brandSoft: "#C46857",
    textPri:   "#1F1A14",
    textSec:   "#5C4F40",
    textMuted: "#8A7E6C",
    divider:   "rgba(139,46,31,0.18)",
    fontDisplay: "var(--font-suez)",
    fontBody:    "var(--font-heebo)",
  },

  // ─── 4. Teal — Modern teal + mint (fresh, clean) ──
  teal: {
    id: "teal",
    name: "Teal",
    description: "טורקיז מודרני · מינט",
    isDark: false,
    bg:        "#F3FBFB",
    bgAlt:     "#CBF0EC",
    card:      "#FFFFFF",
    headerBg:  "rgba(243,251,251,0.95)",
    brand:     "#1A7B8C",
    brandSoft: "#2A97A8",
    textPri:   "#0C3540",
    textSec:   "#2E6570",
    textMuted: "#72A8B2",
    divider:   "rgba(26,123,140,0.15)",
    fontDisplay: "var(--font-heebo)",
    fontBody:    "var(--font-heebo)",
  },

  // ─── 5. Mono — Modern minimalist (off-white + deep navy) ──
  mono: {
    id: "mono",
    name: "Mono",
    description: "מודרני נקי · מינימליסטי",
    isDark: false,
    bg:        "#FAFAFA",
    bgAlt:     "#F0EFEC",
    card:      "#FFFFFF",
    headerBg:  "rgba(250,250,250,0.92)",
    brand:     "#1E3A8A",
    brandSoft: "#3B5BAF",
    textPri:   "#0A0A0A",
    textSec:   "#525252",
    textMuted: "#A3A3A3",
    divider:   "rgba(30,58,138,0.18)",
    fontDisplay: "var(--font-rubik)",
    fontBody:    "var(--font-assistant)",
  },
};

export const DEFAULT_THEME: ThemeId = "onyx";

/** Resolve theme from business.settings JSON (with backward compat). */
export function resolveTheme(settingsJson: string | null | undefined): Theme {
  if (!settingsJson) return THEMES[DEFAULT_THEME];
  try {
    const s = JSON.parse(settingsJson);
    // New field
    if (s.themePreset && s.themePreset in THEMES) {
      return THEMES[s.themePreset as ThemeId];
    }
    // Backward compat: old "theme" field used "light"/"dark"
    if (s.theme === "dark") return THEMES.onyx;
    if (s.theme === "light") return THEMES.vintage;
  } catch {
    /* ignore */
  }
  return THEMES[DEFAULT_THEME];
}
