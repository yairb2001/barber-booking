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
  // ─── 1. Onyx — real gold on warm cream (premium classic) ──
  // Gold is genuinely golden (DarkGoldenrod) — bright enough to read as gold,
  // deep enough to keep large white CTA text legible.
  onyx: {
    id: "onyx",
    name: "אוניקס",
    description: "זהב אמיתי · קרם פרימיום",
    isDark: false,
    bg:        "#FCFAF4",
    bgAlt:     "#F6EFDD",
    card:      "#FFFFFF",
    headerBg:  "rgba(252,250,244,0.95)",
    brand:     "#B8860B",
    brandSoft: "#D4AF37",
    textPri:   "#1F1B12",
    textSec:   "#5E5443",
    textMuted: "#A0937B",
    divider:   "rgba(184,134,11,0.13)",
    fontDisplay: "var(--font-frank)",
    fontBody:    "var(--font-heebo)",
  },

  // ─── 2. Velvet — soft wine + rose (luxury evening) ──
  velvet: {
    id: "velvet",
    name: "ולווט",
    description: "יין רך · רוז'",
    isDark: false,
    bg:        "#FCF7F8",
    bgAlt:     "#F7E9ED",
    card:      "#FFFFFF",
    headerBg:  "rgba(252,247,248,0.95)",
    brand:     "#933A4E",
    brandSoft: "#BC6E7E",
    textPri:   "#2A1118",
    textSec:   "#6B4A52",
    textMuted: "#A98B92",
    divider:   "rgba(147,58,78,0.12)",
    fontDisplay: "var(--font-bellefair)",
    fontBody:    "var(--font-frank)",
  },

  // ─── 3. Vintage — muted brick + cream (classic old-school barber) ──
  vintage: {
    id: "vintage",
    name: "וינטג'",
    description: "לבנה רכה · קרם קלאסי",
    isDark: false,
    bg:        "#F8F3EA",
    bgAlt:     "#EFE6D4",
    card:      "#FFFFFF",
    headerBg:  "rgba(248,243,234,0.95)",
    brand:     "#974236",
    brandSoft: "#C47B6C",
    textPri:   "#221C14",
    textSec:   "#5C4F40",
    textMuted: "#93876F",
    divider:   "rgba(151,66,54,0.12)",
    fontDisplay: "var(--font-suez)",
    fontBody:    "var(--font-heebo)",
  },

  // ─── 4. Teal — soft teal + mint (fresh, clean) ──
  teal: {
    id: "teal",
    name: "טורקיז",
    description: "טורקיז רך · מינט",
    isDark: false,
    bg:        "#F4FBFA",
    bgAlt:     "#E0F2EF",
    card:      "#FFFFFF",
    headerBg:  "rgba(244,251,250,0.95)",
    brand:     "#1A7E76",
    brandSoft: "#3AA59A",
    textPri:   "#0C3A36",
    textSec:   "#2E6660",
    textMuted: "#6FA8A2",
    divider:   "rgba(26,126,118,0.12)",
    fontDisplay: "var(--font-heebo)",
    fontBody:    "var(--font-heebo)",
  },

  // ─── 5. Mono — deep navy on cool off-white (minimalist) — kept as-is ──
  mono: {
    id: "mono",
    name: "מונו",
    description: "נייבי נקי · מינימליסטי",
    isDark: false,
    bg:        "#FAFAFC",
    bgAlt:     "#EEF1F6",
    card:      "#FFFFFF",
    headerBg:  "rgba(250,250,252,0.95)",
    brand:     "#1E3A8A",
    brandSoft: "#3B5BAF",
    textPri:   "#0B1220",
    textSec:   "#4B5563",
    textMuted: "#9AA1AD",
    divider:   "rgba(30,58,138,0.12)",
    fontDisplay: "var(--font-rubik)",
    fontBody:    "var(--font-assistant)",
  },

  // ─── 6. Forest — soft green + sage (earthy, calm) ──
  forest: {
    id: "forest",
    name: "פורסט",
    description: "ירוק רך · מרווה",
    isDark: false,
    bg:        "#F5F9F4",
    bgAlt:     "#E4F0E2",
    card:      "#FFFFFF",
    headerBg:  "rgba(245,249,244,0.95)",
    brand:     "#26713F",
    brandSoft: "#4C9E6E",
    textPri:   "#14241A",
    textSec:   "#46604E",
    textMuted: "#8AA890",
    divider:   "rgba(38,113,63,0.12)",
    fontDisplay: "var(--font-frank)",
    fontBody:    "var(--font-heebo)",
  },

  // ─── 7. Azure — soft royal blue + sky (crisp) ──
  azure: {
    id: "azure",
    name: "אזור",
    description: "כחול רך · שמיים",
    isDark: false,
    bg:        "#F5F8FF",
    bgAlt:     "#E5EEFC",
    card:      "#FFFFFF",
    headerBg:  "rgba(245,248,255,0.95)",
    brand:     "#3A5E9E",
    brandSoft: "#6E8AC0",
    textPri:   "#101D33",
    textSec:   "#44537A",
    textMuted: "#8E9BC0",
    divider:   "rgba(58,94,158,0.12)",
    fontDisplay: "var(--font-rubik)",
    fontBody:    "var(--font-assistant)",
  },

  // ─── 8. Ember — soft burnt orange + peach (warm) ──
  ember: {
    id: "ember",
    name: "אמבר",
    description: "כתום רך · אפרסק",
    isDark: false,
    bg:        "#FFF8F4",
    bgAlt:     "#FCEADD",
    card:      "#FFFFFF",
    headerBg:  "rgba(255,248,244,0.95)",
    brand:     "#B05A30",
    brandSoft: "#D08A5E",
    textPri:   "#2A150B",
    textSec:   "#6B4636",
    textMuted: "#B08B79",
    divider:   "rgba(176,90,48,0.12)",
    fontDisplay: "var(--font-suez)",
    fontBody:    "var(--font-heebo)",
  },

  // ─── 9. Royal — refined purple + lilac (creative, premium) ──
  royal: {
    id: "royal",
    name: "רויאל",
    description: "סגול מעודן · לילך",
    isDark: false,
    bg:        "#F9F6FD",
    bgAlt:     "#EFE7FA",
    card:      "#FFFFFF",
    headerBg:  "rgba(249,246,253,0.95)",
    brand:     "#634393",
    brandSoft: "#8E78B8",
    textPri:   "#1C1330",
    textSec:   "#52447A",
    textMuted: "#9A8BC0",
    divider:   "rgba(99,67,147,0.12)",
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
