/**
 * Where a Chator lead came from (16.10.2026, the marketing manager: "ref או UTM
 * שנשמר בליד ב-CRM"). The sales landing (/for-business) keeps the first touch
 * in localStorage "chator_attr" (utm_*, fbclid, ref); the lead form and the
 * signup send it, and it lands on the lead (Lead.attribution, JSON) and on the
 * business (settings.signupAttribution).
 *
 * The Chator pixel: an empty id keeps it off. The landing page carries the same
 * id in its own script (public/chator/landing.html, CHATOR_PIXEL).
 */
export const CHATOR_PIXEL_ID: string = "";

export type LeadAttribution = { source?: string; medium?: string; campaign?: string; content?: string; term?: string; fbclid?: boolean; ref?: string; ts?: number };

const KEYS = ["source", "medium", "campaign", "content", "term", "ref"] as const;

/** Only known keys, short strings; null when nothing useful came. */
export function cleanAttribution(x: unknown): string | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  const out: LeadAttribution = {};
  for (const k of KEYS) if (typeof o[k] === "string" && (o[k] as string).trim()) out[k] = (o[k] as string).trim().slice(0, 120);
  if (o.fbclid === true || (typeof o.fbclid === "string" && o.fbclid)) out.fbclid = true;
  if (typeof o.ts === "number" && Number.isFinite(o.ts)) out.ts = o.ts;
  return Object.keys(out).some(k => k !== "ts") ? JSON.stringify(out) : null;
}

const SOURCE_HE: Record<string, string> = { ig: "אינסטגרם", instagram: "אינסטגרם", fb: "פייסבוק", facebook: "פייסבוק", meta: "מטא", google: "גוגל", tiktok: "טיקטוק", youtube: "יוטיוב", whatsapp: "וואטסאפ", wa: "וואטסאפ" };
const MEDIUM_HE: Record<string, string> = { social: "אורגני", organic: "אורגני", paid: "ממומן", cpc: "ממומן", paid_social: "ממומן", ads: "ממומן" };
const CONTENT_HE: Record<string, string> = { link_in_bio: "קישור בביו", bio: "קישור בביו", story: "סטורי" };

/** One short Hebrew line for the CRM card: "אינסטגרם · אורגני · קישור בביו". */
export function attributionLabel(json: string | null | undefined): string {
  if (!json) return "";
  let a: LeadAttribution;
  try { a = JSON.parse(json); } catch { return ""; }
  const src = a.source ? SOURCE_HE[a.source.toLowerCase()] ?? a.source : a.fbclid ? "פייסבוק או אינסטגרם" : "";
  const parts = [
    src,
    a.medium ? MEDIUM_HE[a.medium.toLowerCase()] ?? a.medium : "",
    a.content ? CONTENT_HE[a.content.toLowerCase()] ?? a.content : "",
    a.campaign ? `קמפיין ${a.campaign}` : "",
    a.ref ? `הפניה: ${a.ref}` : "",
  ].filter(Boolean);
  return parts.join(" · ");
}
