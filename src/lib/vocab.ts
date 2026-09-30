/**
 * Vocabulary per business type (stage 0 of docs/PLAN-MASTER.md).
 * ─────────────────────────────────────────────────────────────
 * One place that knows how a business talks about itself: the professional
 * (ספר / ספרית / מניקוריסטית / קוסמטיקאית), the place (מספרה / סטודיו / מכון),
 * the customer, the default service. The default agent prompt template, the
 * setup interview and the customer-facing booking screens read from here, so a
 * nail studio never sees the word "ספר" — and DOMINANT (barber_men) keeps the
 * exact words it has today.
 *
 * Hebrew grammar rides along: the gender of the professional noun changes the
 * adjectives around it (הספר הפנוי / הספרית הפנויה), so every gendered form a
 * template needs is spelled out here rather than derived at the call site.
 *
 * A business may override single words through Business.settings.vocab
 * (e.g. { "staff": "מעצב שיער" }) — see vocabFor().
 */

export type BusinessType = "barber_men" | "barber_women" | "nails" | "cosmetics";

export const BUSINESS_TYPES: ReadonlyArray<{ id: BusinessType; label: string }> = [
  { id: "barber_men",   label: "מספרת גברים" },
  { id: "barber_women", label: "מספרת נשים" },
  { id: "nails",        label: "סטודיו ציפורניים" },
  { id: "cosmetics",    label: "מכון קוסמטיקה" },
];

export const DEFAULT_BUSINESS_TYPE: BusinessType = "barber_men";

export function isBusinessType(x: unknown): x is BusinessType {
  return typeof x === "string" && BUSINESS_TYPES.some(t => t.id === x);
}

/** The type of a business row (or anything shaped like one); unknown → barber_men. */
export function businessTypeOf(biz: { businessType?: string | null } | null | undefined): BusinessType {
  return isBusinessType(biz?.businessType) ? biz.businessType : DEFAULT_BUSINESS_TYPE;
}

export type Vocab = {
  type: BusinessType;
  /** Human label of the type: "מספרת גברים". */
  typeLabel: string;
  /** What the business is, for the prompt's first line: "מספרה לגברים". */
  placeKind: string;
  /** The place, indefinite / definite: מספרה / המספרה. */
  place: string;
  placeDef: string;
  /** The professional — singular, definite, plural, definite plural. */
  staff: string;
  staffDef: string;
  staffPlural: string;
  staffPluralDef: string;
  /** Grammatical gender of the professional noun (drives the forms below). */
  staffFem: boolean;
  /** Gendered forms that follow the professional: פנוי/פנויה, הקבוע/הקבועה … */
  free: string;
  freePlural: string;
  regular: string;
  main: string;
  other: string;
  such: string;      // כזה / כזאת
  works: string;     // עובד / עובדת
  writes: string;    // כותב / כותבת
  none: string;      // "אף ספר" / "אף ספרית"
  /** The customer — singular / plural, and the gender the prompt should assume. */
  customer: string;
  customerPlural: string;
  customerFem: boolean;
  /** Imperatives addressed to the customer on the booking screens: בחר/בחרי, נסה/נסי. */
  choose: string;
  tryVerb: string;
  /** "ידע" / "תדע" — the professional, in "משהו שכדאי שהספר ידע?". */
  knows: string;
  /** What the agent books when the customer just says "רוצה תור". */
  defaultService: string;
  /** A couple of typical services, for the setup question's hint. */
  serviceExamples: string;
  /** Whether street slang ("אחי") is an allowed address style (decision #9: barber_men only). */
  slangAllowed: boolean;
  /** Starter catalog the setup wizard offers (market prices, editable). */
  serviceCatalog: { name: string; price: number; duration: number }[];
};

const BASE: Record<BusinessType, Vocab> = {
  barber_men: {
    type: "barber_men", typeLabel: "מספרת גברים", placeKind: "מספרה לגברים",
    place: "מספרה", placeDef: "המספרה",
    staff: "ספר", staffDef: "הספר", staffPlural: "ספרים", staffPluralDef: "הספרים", staffFem: false,
    free: "פנוי", freePlural: "פנויים", regular: "הקבוע", main: "הראשי", other: "אחר", such: "כזה",
    works: "עובד", writes: "כותב", none: "אף ספר",
    customer: "לקוח", customerPlural: "לקוחות", customerFem: false, choose: "בחר", tryVerb: "נסה", knows: "ידע",
    defaultService: "תספורת + זקן", serviceExamples: "תספורת, תספורת + זקן, זקן",
    slangAllowed: true,
    serviceCatalog: [{ name: "תספורת", price: 80, duration: 30 }, { name: "תספורת + זקן", price: 110, duration: 45 }, { name: "עיצוב זקן", price: 40, duration: 20 }, { name: "תספורת מספריים", price: 120, duration: 40 }, { name: "תספורת ילד", price: 60, duration: 25 }],
  },
  barber_women: {
    type: "barber_women", typeLabel: "מספרת נשים", placeKind: "מספרה לנשים",
    place: "מספרה", placeDef: "המספרה",
    staff: "ספרית", staffDef: "הספרית", staffPlural: "ספריות", staffPluralDef: "הספריות", staffFem: true,
    free: "פנויה", freePlural: "פנויות", regular: "הקבועה", main: "הראשית", other: "אחרת", such: "כזאת",
    works: "עובדת", writes: "כותבת", none: "אף ספרית",
    customer: "לקוחה", customerPlural: "לקוחות", customerFem: true, choose: "בחרי", tryVerb: "נסי", knows: "תדע",
    defaultService: "תספורת", serviceExamples: "תספורת, פן, צבע, גוונים",
    slangAllowed: false,
    serviceCatalog: [{ name: "תספורת", price: 150, duration: 45 }, { name: "פן", price: 120, duration: 40 }, { name: "צבע", price: 300, duration: 90 }, { name: "גוונים", price: 450, duration: 150 }],
  },
  nails: {
    type: "nails", typeLabel: "סטודיו ציפורניים", placeKind: "סטודיו לציפורניים",
    place: "סטודיו", placeDef: "הסטודיו",
    staff: "מניקוריסטית", staffDef: "המניקוריסטית", staffPlural: "מניקוריסטיות", staffPluralDef: "המניקוריסטיות", staffFem: true,
    free: "פנויה", freePlural: "פנויות", regular: "הקבועה", main: "הראשית", other: "אחרת", such: "כזאת",
    works: "עובדת", writes: "כותבת", none: "אף מניקוריסטית",
    customer: "לקוחה", customerPlural: "לקוחות", customerFem: true, choose: "בחרי", tryVerb: "נסי", knows: "תדע",
    defaultService: "מניקור ג'ל", serviceExamples: "מניקור ג'ל, בנייה, מילוי, פדיקור",
    slangAllowed: false,
    serviceCatalog: [{ name: "מניקור ג'ל", price: 120, duration: 60 }, { name: "בנייה", price: 250, duration: 120 }, { name: "מילוי", price: 180, duration: 90 }, { name: "פדיקור", price: 150, duration: 60 }],
  },
  cosmetics: {
    type: "cosmetics", typeLabel: "מכון קוסמטיקה", placeKind: "מכון קוסמטיקה",
    place: "מכון", placeDef: "המכון",
    staff: "קוסמטיקאית", staffDef: "הקוסמטיקאית", staffPlural: "קוסמטיקאיות", staffPluralDef: "הקוסמטיקאיות", staffFem: true,
    free: "פנויה", freePlural: "פנויות", regular: "הקבועה", main: "הראשית", other: "אחרת", such: "כזאת",
    works: "עובדת", writes: "כותבת", none: "אף קוסמטיקאית",
    customer: "לקוחה", customerPlural: "לקוחות", customerFem: true, choose: "בחרי", tryVerb: "נסי", knows: "תדע",
    defaultService: "טיפול פנים", serviceExamples: "טיפול פנים, הסרת שיער, עיצוב גבות",
    slangAllowed: false,
    serviceCatalog: [{ name: "טיפול פנים", price: 350, duration: 75 }, { name: "עיצוב גבות", price: 80, duration: 20 }, { name: "הסרת שיער בשעווה", price: 150, duration: 45 }],
  },
};

/** Keys a business may override through settings.vocab (single words only —
 *  the gendered helpers are derived from the type, not overridable). */
const OVERRIDABLE = new Set<keyof Vocab>(["place", "placeDef", "placeKind", "staff", "staffDef", "staffPlural", "staffPluralDef", "customer", "customerPlural", "defaultService", "serviceExamples"]);

export function vocabFor(type: string | null | undefined, overrides?: Record<string, unknown> | null): Vocab {
  const base = BASE[isBusinessType(type) ? type : DEFAULT_BUSINESS_TYPE];
  if (!overrides || typeof overrides !== "object") return base;
  const out: Vocab = { ...base };
  for (const [k, v] of Object.entries(overrides)) {
    if (OVERRIDABLE.has(k as keyof Vocab) && typeof v === "string" && v.trim()) (out as unknown as Record<string, string>)[k] = v.trim();
  }
  return out;
}

/** vocabFor() straight from a business row: type column + settings.vocab overrides. */
export function vocabOf(biz: { businessType?: string | null; settings?: string | null } | null | undefined): Vocab {
  let overrides: Record<string, unknown> | null = null;
  if (biz?.settings) {
    try { const s = JSON.parse(biz.settings) as { vocab?: Record<string, unknown> }; if (s && typeof s.vocab === "object") overrides = s.vocab ?? null; } catch { /* ignore */ }
  }
  return vocabFor(biz?.businessType, overrides);
}
