/**
 * What a business does (28.10.2026, spec "הקמה עצמית ליופי"): the owner picks
 * one or more domains at signup ("מה עושים אצלכם?"). One domain is exactly the
 * business type of before, so a men's barbershop changes nothing. Several are
 * turned here into a type, words and a starter catalog, so a salon for men and
 * women needs no script.
 */
import { vocabFor, type BusinessType, type Vocab } from "@/lib/vocab";

export type Domain = "barber_men" | "barber_women" | "nails" | "cosmetics";

export const DOMAINS: ReadonlyArray<{ id: Domain; label: string; category: string }> = [
  { id: "barber_men", label: "תספורות גברים", category: "גברים" },
  { id: "barber_women", label: "שיער לנשים", category: "שיער לנשים" },
  { id: "nails", label: "ציפורניים", category: "ציפורניים" },
  { id: "cosmetics", label: "קוסמטיקה", category: "קוסמטיקה" },
];

export const isDomain = (x: unknown): x is Domain => DOMAINS.some(d => d.id === x);

/** Valid domains in the screen's order, once each. */
export const cleanDomains = (x: unknown): Domain[] =>
  Array.isArray(x) ? DOMAINS.map(d => d.id).filter(id => x.includes(id)) : [];

/** The business type, and the words that differ from it, for the picked domains. */
export function setupForDomains(picked: Domain[]): { businessType: BusinessType; vocab: Record<string, string> | null } {
  const d = cleanDomains(picked);
  if (!d.length) return { businessType: "other", vocab: null };
  if (d.length === 1) return { businessType: d[0], vocab: null };
  if (d.includes("barber_men")) {
    // Men and women: the mixed rules of type "other" (address by how they write, no "ברוך הבא").
    const placeKind = d.length === 2 && d.includes("barber_women") ? "מספרה לגברים ולנשים" : "מספרה ומכון יופי לגברים ולנשים";
    return { businessType: "other", vocab: { placeKind, place: "מספרה", placeDef: "המספרה" } };
  }
  const hair = d.includes("barber_women");
  return {
    businessType: d.includes("cosmetics") ? "cosmetics" : "nails",
    vocab: { placeKind: hair ? "מספרה ומכון יופי" : "מכון יופי", place: hair ? "מספרה" : "מכון", placeDef: hair ? "המספרה" : "המכון", staff: "מטפלת", staffPlural: "מטפלות" },
  };
}

/** The domains of a business: what it picked at signup, else its type when that is one. */
export function domainsOf(biz: { businessType?: string | null; settings?: string | Record<string, unknown> | null } | null | undefined): Domain[] {
  let s: Record<string, unknown> = {};
  try { s = typeof biz?.settings === "string" ? JSON.parse(biz.settings) : biz?.settings ?? {}; } catch { /* none */ }
  const picked = cleanDomains(s.domains);
  if (picked.length) return picked;
  return isDomain(biz?.businessType) ? [biz.businessType] : [];
}

export type StarterService = Vocab["serviceCatalog"][number] & { domain: Domain };

/** The starter catalog of the picked domains. With several, each domain is its
 *  own category (what the agent asks by), and a name both domains have
 *  ("תספורת") says whose it is. */
export function starterCatalog(picked: Domain[]): StarterService[] {
  const d = cleanDomains(picked);
  const label = (id: Domain) => DOMAINS.find(x => x.id === id)!.category;
  const items = d.flatMap(id => vocabFor(id).serviceCatalog.map(s => ({ ...s, domain: id, ...(d.length > 1 ? { category: label(id) } : {}) })));
  const count = new Map<string, number>();
  for (const s of items) count.set(s.name, (count.get(s.name) ?? 0) + 1);
  return items.map(s => (count.get(s.name)! > 1 ? { ...s, name: `${s.name} ${s.domain === "barber_men" ? "גברים" : "נשים"}` } : s));
}

/** The line next to a service that needs a consultation the first time (the agent offers it first). */
export const CONSULT_FIRST_NOTE = "בפעם הראשונה: קודם ייעוץ";
