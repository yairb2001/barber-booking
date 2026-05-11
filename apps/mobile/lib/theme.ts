// ─── Theme utilities (adapted from src/lib/themes.ts for React Native) ───────

export type AppTheme = {
  id: string;
  name: string;
  isDark: boolean;
  bg: string;
  bgAlt: string;
  card: string;
  brand: string;
  brandSoft: string;
  textPri: string;
  textSec: string;
  textMuted: string;
  divider: string;
};

export const THEMES: Record<string, AppTheme> = {
  onyx: {
    id: "onyx",
    name: "Onyx",
    isDark: true,
    bg: "#0A0A0A",
    bgAlt: "#141414",
    card: "#1A1A1A",
    brand: "#D4AF37",
    brandSoft: "#A87C2A",
    textPri: "#F5F0E1",
    textSec: "#A8A099",
    textMuted: "#6B6359",
    divider: "rgba(212,175,55,0.18)",
  },
  velvet: {
    id: "velvet",
    name: "Velvet",
    isDark: true,
    bg: "#1A0E12",
    bgAlt: "#2A1820",
    card: "#38242B",
    brand: "#D4A574",
    brandSoft: "#9C7449",
    textPri: "#F5E8D8",
    textSec: "#B8A89A",
    textMuted: "#7A6A5C",
    divider: "rgba(212,165,116,0.20)",
  },
  vintage: {
    id: "vintage",
    name: "Vintage",
    isDark: false,
    bg: "#F4EDDF",
    bgAlt: "#EAE0CC",
    card: "#FFFFFF",
    brand: "#8B2E1F",
    brandSoft: "#C46857",
    textPri: "#1F1A14",
    textSec: "#5C4F40",
    textMuted: "#8A7E6C",
    divider: "rgba(139,46,31,0.18)",
  },
  teal: {
    id: "teal",
    name: "Teal",
    isDark: false,
    bg: "#F3FBFB",
    bgAlt: "#CBF0EC",
    card: "#FFFFFF",
    brand: "#1A7B8C",
    brandSoft: "#2A97A8",
    textPri: "#0C3540",
    textSec: "#2E6570",
    textMuted: "#72A8B2",
    divider: "rgba(26,123,140,0.15)",
  },
  mono: {
    id: "mono",
    name: "Mono",
    isDark: false,
    bg: "#FAFAFA",
    bgAlt: "#F0EFEC",
    card: "#FFFFFF",
    brand: "#1E3A8A",
    brandSoft: "#3B5BAF",
    textPri: "#0A0A0A",
    textSec: "#525252",
    textMuted: "#A3A3A3",
    divider: "rgba(30,58,138,0.18)",
  },
};

export const DEFAULT_THEME_ID = "onyx";

export function resolveTheme(apiTheme?: AppTheme | null): AppTheme {
  if (apiTheme && apiTheme.id && THEMES[apiTheme.id]) {
    return THEMES[apiTheme.id];
  }
  return THEMES[DEFAULT_THEME_ID];
}

/** Convert hex to rgba string (for shadows / overlays) */
export function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Format price in NIS */
export function formatPrice(price: number): string {
  return `₪${price}`;
}

/** Format duration in minutes to readable string */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} דק'`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}:${String(m).padStart(2, "0")} שעות` : `${h} שע'`;
}
