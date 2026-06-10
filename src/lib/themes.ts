// ─── Curated theme presets ──────────────────────────────────────────────────
// Hand-tuned color + font palettes. Admin picks one — every color is already
// harmonized. No individual color pickers anywhere in the UI.
//
// DESIGN LANGUAGE (why they look good):
//  • Every brand color is contrast-safe for WHITE text on a filled button
//    (the customer pages render on light surfaces, so a pale "champagne" brand
//    would read as washed-out — all brands here are deep enough to pop).
//  • Each preset carries its own light SURFACE TINT (bg + bgAlt) so the whole
//    page background shifts with the theme, not just the buttons. Cards stay
//    pure white to float cleanly above the tint.
//  • Text colors are hue-matched to the brand (warm themes get warm-grey text,
//    cool themes get cool-grey) so nothing feels "stuck on".

export type ThemeId =
  | "onyx" | "velvet" | "vintage" | "mono" | "teal"
  | "forest" | "azure" | "ember" | "royal";

export type Theme = {
  id: ThemeId;
  name: string;        // Hebrew label shown in admin
  description: string; // Hebrew sub-label
  isDark: boolean;

  // ── Surface colors ──
  bg: string;          // main page background (soft brand tint)
  bgAlt: string;       // alternating section background (stronger tint)
  card: string;        // card / panel background
  headerBg: string;    // sticky header rgba (with alpha for blur)

  // ── Brand & text ──
  brand: string;       // primary accent (CTAs, headlines, dots) — white-text safe
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
  // ─── 1. Onyx — warm gold on cream (premium classic) ──
  onyx: {
    id: "onyx",
    name: "אוניקס",
    description: "זהב חם · קרם פרימיום",
    isDark: false,
    bg:        "#FBF8F1",
    bgAlt:     "#F2E8D2",
    card:      "#FFFFFF",
    headerBg:  "rgba(251,248,241,0.95)",
    brand:     "#8A6A1E",
    brandSoft: "#B89233",
    textPri:   "#1C1812",
    textSec:   "#5A5043",
    textMuted: "#9A8D78",
    divider:   "rgba(138,106,30,0.14)",
    fontDisplay: "var(--font-frank)",
    fontBody:    "var(--font-heebo)",
  },

  // ─── 2. Velvet — deep wine + soft rose (luxury evening) ──
  velvet: {
    id: "velvet",
    name: "ולווט",
    description: "יין עמוק · רוז' רך",
    isDark: false,
    bg:        "#FCF6F7",
    bgAlt:     "#F5E1E7",
    card:      "#FFFFFF",
    headerBg:  "rgba(252,246,247,0.95)",
    brand:     "#8E2C44",
    brandSoft: "#B85B72",
    textPri:   "#2A1118",
    textSec:   "#6B4A52",
    textMuted: "#A98B92",
    divider:   "rgba(142,44,68,0.13)",
    fontDisplay: "var(--font-bellefair)",
    fontBody:    "var(--font-frank)",
  },

  // ─── 3. Vintage — brick + cream (classic old-school barber) ──
  vintage: {
    id: "vintage",
    name: "וינטג'",
    description: "לבנה חמה · קרם קלאסי",
    isDark: false,
    bg:        "#F7F1E6",
    bgAlt:     "#ECDFC8",
    card:      "#FFFFFF",
    headerBg:  "rgba(247,241,230,0.95)",
    brand:     "#8B2E1F",
    brandSoft: "#C46857",
    textPri:   "#221C14",
    textSec:   "#5C4F40",
    textMuted: "#93876F",
    divider:   "rgba(139,46,31,0.14)",
    fontDisplay: "var(--font-suez)",
    fontBody:    "var(--font-heebo)",
  },

  // ─── 4. Teal — modern teal + mint (fresh, clean) ──
  teal: {
    id: "teal",
    name: "טורקיז",
    description: "טורקיז מודרני · מינט",
    isDark: false,
    bg:        "#F2FBFA",
    bgAlt:     "#D3EFEB",
    card:      "#FFFFFF",
    headerBg:  "rgba(242,251,250,0.95)",
    brand:     "#0F766E",
    brandSoft: "#2A9D90",
    textPri:   "#0C3A36",
    textSec:   "#2E6660",
    textMuted: "#6FA8A2",
    divider:   "rgba(15,118,110,0.13)",
    fontDisplay: "var(--font-heebo)",
    fontBody:    "var(--font-heebo)",
  },

  // ─── 5. Mono — deep navy on cool off-white (minimalist) ──
  mono: {
    id: "mono",
    name: "מונו",
    description: "נייבי נקי · מינימליסטי",
    isDark: false,
    bg:        "#FAFAFB",
    bgAlt:     "#EBEEF4",
    card:      "#FFFFFF",
    headerBg:  "rgba(250,250,251,0.95)",
    brand:     "#1E3A8A",
    brandSoft: "#3B5BAF",
    textPri:   "#0B1220",
    textSec:   "#4B5563",
    textMuted: "#9AA1AD",
    divider:   "rgba(30,58,138,0.13)",
    fontDisplay: "var(--font-rubik)",
    fontBody:    "var(--font-assistant)",
  },

  // ─── 6. Forest — deep green + sage (earthy, calm) ──
  forest: {
    id: "forest",
    name: "פורסט",
    description: "ירוק עמוק · מרווה",
    isDark: false,
    bg:        "#F4F9F3",
    bgAlt:     "#DCEDDB",
    card:      "#FFFFFF",
    headerBg:  "rgba(244,249,243,0.95)",
    brand:     "#166534",
    brandSoft: "#3F9C63",
    textPri:   "#14241A",
    textSec:   "#46604E",
    textMuted: "#8AA890",
    divider:   "rgba(22,101,52,0.13)",
    fontDisplay: "var(--font-frank)",
    fontBody:    "var(--font-heebo)",
  },

  // ─── 7. Azure — royal blue + sky (crisp, energetic) ──
  azure: {
    id: "azure",
    name: "אזור",
    description: "כחול מלכותי · שמיים",
    isDark: false,
    bg:        "#F4F8FF",
    bgAlt:     "#DBE8FB",
    card:      "#FFFFFF",
    headerBg:  "rgba(244,248,255,0.95)",
    brand:     "#1D4ED8",
    brandSoft: "#4E7DE8",
    textPri:   "#0C1A33",
    textSec:   "#41527A",
    textMuted: "#8C9BC0",
    divider:   "rgba(29,78,216,0.13)",
    fontDisplay: "var(--font-rubik)",
    fontBody:    "var(--font-assistant)",
  },

  // ─── 8. Ember — burnt orange + peach (warm, bold) ──
  ember: {
    id: "ember",
    name: "אמבר",
    description: "כתום שרוף · אפרסק",
    isDark: false,
    bg:        "#FFF7F2",
    bgAlt:     "#FBE4D5",
    card:      "#FFFFFF",
    headerBg:  "rgba(255,247,242,0.95)",
    brand:     "#C2410C",
    brandSoft: "#E26A35",
    textPri:   "#2A150B",
    textSec:   "#6B4636",
    textMuted: "#B08B79",
    divider:   "rgba(194,65,12,0.13)",
    fontDisplay: "var(--font-suez)",
    fontBody:    "var(--font-heebo)",
  },

  // ─── 9. Royal — deep purple + lilac (creative, premium) ──
  royal: {
    id: "royal",
    name: "רויאל",
    description: "סגול עמוק · לילך",
    isDark: false,
    bg:        "#F8F5FD",
    bgAlt:     "#E9DEF8",
    card:      "#FFFFFF",
    headerBg:  "rgba(248,245,253,0.95)",
    brand:     "#6D28D9",
    brandSoft: "#9259E8",
    textPri:   "#1C1330",
    textSec:   "#52447A",
    textMuted: "#9A8BC0",
    divider:   "rgba(109,40,217,0.13)",
    fontDisplay: "var(--font-bellefair)",
    fontBody:    "var(--font-heebo)",
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
