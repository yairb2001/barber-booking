/**
 * Setup-interview field spec + compiler.
 * ──────────────────────────────────────
 * The self-configuring onboarding interview (run by the owner agent) fills these
 * STRUCTURED fields — never free prose. `compileSetupConfig` then renders them
 * into a short, fixed-format Hebrew block that becomes the shop's private layer
 * on top of the shared customer-agent brain. Structure in → lean prompt out, with
 * no contradictions and no bloat.
 *
 * Two kinds of setup answers exist in the product:
 *   • prompt-shaping (here) — tone, defaults, policy, logistics → become prompt text.
 *   • system toggles (elsewhere) — escalatePhone, requireSwapApproval,
 *     allowSwapOffers, reengageEnabled, bookingHorizonDays → written straight to
 *     their own columns; they change behaviour in code, not via the prompt.
 *
 * This module owns ONLY the prompt-shaping fields. Keep it that way — mixing the
 * two is how the layer starts to bloat.
 */

import { vocabFor, type BusinessType, type Vocab } from "@/lib/vocab";

/** The defaultService answer that means "show the list and ask" (16.10.2026). Words that ask for a list count too. */
export const SERVICE_LIST = "להציג רשימת שירותים";
export const isServiceList = (v: unknown) => typeof v === "string" && (v.trim() === SERVICE_LIST || /רשימ/.test(v));

export type SetupFieldType = "choice" | "text" | "bool";

/** Keys the compact template (prompt-template.ts) renders into its own
 *  sections — each answer REPLACES a part of the base prompt instead of being
 *  appended as an extra line (spec "תפעול והגדרת הסוכן", 10.10.2026). For a
 *  business on the template, compileSetupConfig skips them; only a business
 *  with a hand-written prompt still gets them as the appended block. */
export const TEMPLATE_CONSUMED_SETUP_KEYS = new Set([
  "tone", "emojis", "address", "defaultService", "barberAssign",
  "priceNote", "cancelPolicy", "deposit", "walkin", "location", "payment",
  "styleNotes", "styleSamples", "escalateWhen", "platformNotes", "businessRules",
]);

/** Written only by the platform (CRM card / promote script), never asked in the
 *  interview: what is unique to one business and has no question of its own
 *  (DOMINANT: the "טקסט לחריטה" example, barbers who start at 10–11). The
 *  template renders it as the business's own block; an owner cannot write it. */
export const PLATFORM_ONLY_SETUP_KEYS = new Set(["platformNotes"]);

/** One interview field, already resolved for a business type (words, options,
 *  defaults) — what the owner agent and the compiler work with. */
export type SetupField = {
  /** Stored key inside AgentConfig.setupConfig (JSON). */
  key: string;
  /** Short title for screens ("טון", "מדיניות ביטול"). */
  label: string;
  /** Grouping label (for the interview UI / ordering only). */
  group: string;
  /** The verbatim question the agent asks the owner. */
  question: string;
  type: SetupFieldType;
  /** For type "choice": the allowed answers. */
  options?: string[];
  /** Suggested default the owner can accept as-is. */
  default?: string | boolean;
  /** Must be answered before the agent may go live. */
  core: boolean;
  /** Free text that deserves a big box (style notes, sample messages). */
  multiline?: boolean;
  /** A short plain explanation for screens: what this changes in the agent's answers. */
  help?: string;
  /**
   * Renders this field's stored value into one prompt line. Return "" to omit
   * (e.g. a bool that's false and needs no mention). `v` is the stored value.
   */
  compile: (v: string | boolean) => string;
};

/** The catalog entry: the same field, written once for every vertical. Words
 *  come from the vocabulary, and a field may be limited to some verticals
 *  (`verticals`) or phrase its question / options differently per type. */
type SetupFieldSpec = {
  key: string;
  label: string | ((v: Vocab) => string);
  group: string;
  type: SetupFieldType;
  core: boolean;
  multiline?: boolean;
  /** Omitted = every business type. */
  verticals?: BusinessType[];
  question: (v: Vocab) => string;
  questionByType?: Partial<Record<BusinessType, string>>;
  options?: (v: Vocab) => string[];
  default?: (v: Vocab) => string | boolean;
  compile: (value: string | boolean, v: Vocab) => string;
};

/**
 * The prompt-shaping questions, in ask-order. System-toggle questions (swap
 * approval, waitlist, reminders, reengage, escalation phone, booking horizon)
 * are handled against their own columns and are intentionally NOT here.
 */
const SETUP_FIELD_SPECS: SetupFieldSpec[] = [
  // ── A. Identity & tone ──
  {
    key: "tone", label: "טון", group: "זהות וטון", core: false, type: "choice",
    options: () => ["רשמי", "חברי", "קליל-רחוב"], default: () => "חברי",
    question: () => "איזה טון מתאים לך מול לקוחות? רשמי / חברי / קליל-רחוב",
    compile: v => `דבר בטון ${v}.`,
  },
  {
    key: "emojis", label: "אימוג'ים", group: "זהות וטון", core: false, type: "choice",
    options: () => ["בלי", "מעט", "הרבה"], default: () => "מעט",
    question: () => "כמה אימוג'ים להשתמש בשיחות? בלי / מעט / הרבה",
    compile: v => v === "בלי" ? "אל תשתמש באימוג'ים." : v === "הרבה" ? "אפשר להשתמש באימוג'ים בחופשיות." : "השתמש במעט אימוג'ים, במידה.",
  },
  {
    // Decision #9 (docs/PLAN-MASTER.md): street slang only where it belongs — barber_men.
    key: "address", label: "פנייה ללקוח", group: "זהות וטון", core: false, type: "choice",
    options: v => v.slangAllowed ? ["בשם פרטי", "אחי", "ניטרלי"] : ["בשם פרטי", "ניטרלי"], default: () => "בשם פרטי",
    question: v => v.slangAllowed ? "איך לפנות ללקוח? בשם פרטי / 'אחי' / ניטרלי" : `איך לפנות ל${v.customer}? בשם פרטי / ניטרלי`,
    compile: (v, voc) => v === "אחי" && voc.slangAllowed ? "פנה ללקוח ב'אחי'." : v === "ניטרלי" ? `פנה ל${voc.customer} בצורה ניטרלית, בלי שם.` : `פנה ל${voc.customer} בשם${voc.customerFem ? "ה" : "ו"} הפרטי.`,
  },

  // ── B. Booking defaults ──
  // A service to assume, or SERVICE_LIST: show the services and ask (16.10.2026, Yair).
  {
    key: "defaultService", label: "שירות ברירת מחדל", group: "ברירות מחדל", core: true, type: "text",
    default: v => v.defaultService,
    question: v => `כש${v.customer} ${v.customerFem ? "כותבת" : "כותב"} 'רוצה תור' בלי לפרט: לאיזה שירות לקבוע, או "${SERVICE_LIST}"? (למשל: ${v.serviceExamples})`,
    questionByType: { barber_men: `כשלקוח כותב 'רוצה תור' בלי לפרט: לאיזה שירות לקבוע, או "${SERVICE_LIST}"? (רוב המספרות: תספורת + זקן)` },
    compile: (v, voc) => isServiceList(v)
      ? `כש${voc.customer} לא ${voc.customerFem ? "מציינת" : "מציין"} שירות, שאל איזה שירות והצג את רשימת השירותים עם המחירים.`
      : `כש${voc.customer} לא ${voc.customerFem ? "מציינת" : "מציין"} שירות, הנח ש${voc.customerFem ? "היא רוצה" : "הוא רוצה"}: ${v}.`,
  },
  {
    key: "barberAssign", label: "שיבוץ כשלא ביקשו מישהו", group: "ברירות מחדל", core: true, type: "choice",
    options: v => ["הכי פנוי", "לשאול", `${v.staff} ${v.staffFem ? "קבועה" : "קבוע"}`], default: () => "הכי פנוי",
    question: v => `כש${v.customer} לא ${v.customerFem ? "מבקשת" : "מבקש"} ${v.staff} ${v.staffFem ? "מסוימת" : "מסוים"} — איך לשבץ? (הכי ${v.free}: בשקט אצל מי שפנוי. לשאול: שואלים אצל מי נוח. ${v.staff} ${v.staffFem ? "קבועה" : "קבוע"}: אצל מי שעשה לו בפעם הקודמת, בלי לשאול)`,
    compile: (v, voc) => {
      const c = voc.customer, him = voc.customerFem ? "אותה" : "אותו", his = voc.customerFem ? "היא מעדיפה" : "הוא מעדיף";
      const notAsking = `כש${c} לא ${voc.customerFem ? "מבקשת" : "מבקש"} ${voc.staff}`;
      if (v === "לשאול") return `${notAsking}, שאל ${him} אצל מי ${his}.`;
      if (typeof v === "string" && v.startsWith(voc.staff)) return `${notAsking}, שבץ ${him} אצל ${voc.staffDef} ${voc.regular} של${voc.customerFem ? "ה" : "ו"} לפי ההיסטוריה, בלי לשאול; אין — אצל ${voc.staffDef} ${voc.staffFem ? "הפנויה" : "הפנוי"} ביותר.`;
      return `${notAsking}, שבץ ${him} בשקט אצל ${voc.staffDef} ${voc.staffFem ? "הפנויה" : "הפנוי"} ביותר.`;
    },
  },

  // ── B2. Prices — only when the price depends on who does it ──
  {
    key: "priceNote", label: "מחיר כשלא ברור אצל מי", group: "ברירות מחדל", core: false, type: "text",
    question: v => `כש${v.customer} ${v.customerFem ? "שואלת" : "שואל"} כמה זה עולה ועוד לא ברור אצל מי, איזה מחיר להגיד? (רק אם המחירים שונים בין ${v.staffPlural}, למשל: 90₪ תספורת + זקן, 120–130₪ מספריים)`,
    compile: v => `כשלא ברור אצל מי, המחיר להגיד: ${v}.`,
  },

  // ── C. Policy ──
  {
    key: "cancelPolicy", label: "מדיניות ביטול", group: "מדיניות", core: false, type: "text",
    default: () => "עד שעתיים לפני התור",
    question: () => "עד כמה זמן לפני התור מותר לבטל בלי בעיה? (ברירת מחדל: עד שעתיים לפני)",
    compile: v => `מדיניות ביטול: אפשר לבטל ${v}.`,
  },
  {
    key: "deposit", label: "מקדמה", group: "מדיניות", core: false, type: "bool", default: () => false,
    question: () => "גובים מקדמה על תור? כן / לא",
    compile: (v, voc) => v === true ? `יש לגבות מקדמה על תור — אם ${voc.customer} ${voc.customerFem ? "שואלת" : "שואל"}, ציין זאת.` : "",
  },
  {
    key: "walkin", label: "הגעה בלי תור", group: "מדיניות", core: false, type: "bool", default: () => true,
    question: v => `מקבלים ${v.customer} בלי תור מראש (walk-in)? כן / לא`,
    compile: v => v === false ? "לא מקבלים לקוחות ללא תור מראש — צריך לקבוע." : "אפשר להגיע גם בלי תור מראש.",
  },

  // ── D. Logistics & FAQ ──
  {
    key: "location", label: "הגעה ומיקום", group: "לוגיסטיקה", core: false, type: "text",
    question: v => `איפה בדיוק ${v.placeDef}? קומה, כניסה, חניה — מה כדאי שאגיד ללקוחות?`,
    compile: v => `מיקום והגעה: ${v}.`,
  },
  {
    key: "payment", label: "אמצעי תשלום", group: "לוגיסטיקה", core: false, type: "text",
    default: () => "מזומן, אשראי וביט",
    question: () => "אמצעי תשלום? מזומן / אשראי / ביט / הכל",
    compile: v => `אמצעי תשלום מקובלים: ${v}.`,
  },

  // ── D1. The shop's small things (10.10.2026, Yair: "לכל עסק יש את השיקולים שלו") ──
  {
    key: "kids", label: "ילדים", group: "כללים ופרטים", core: false, type: "text",
    question: v => v.type === "barber_men" ? "מספרים ילדים? מגיל כמה ובכמה? (למשל: מגיל 3, תספורת ילד 50 ₪)"
      : v.type === "barber_women" ? "מספרים ילדות? מגיל כמה ובכמה? (למשל: מגיל 4, תספורת ילדה 80 ₪)"
      : v.type === "other" ? "מקבלים ילדים או קטינים? מגיל כמה, ועם אישור הורה? (למשל: מגיל 12, עם אישור של הורה)"
      : "מקבלים קטינות? מגיל כמה, ועם אישור הורה? (למשל: מגיל 14, עם אישור חתום של הורה)",
    compile: v => `ילדים: ${v}.`,
  },
  {
    key: "groupBooking", label: "כמה אנשים ברצף", group: "כללים ופרטים", core: false, type: "choice",
    options: () => ["כן, אחד אחרי השני", "רק אם שואלים", "לא, כל אחד קובע לבד"], default: () => "כן, אחד אחרי השני",
    question: v => `${v.customer} רוצה לקבוע לכמה אנשים ברצף (${v.customerFem ? "אמא ובת, שתי חברות" : "אבא וילד, שני חברים"})? כן / רק אם שואלים / לא`,
    compile: v => v === "לא, כל אחד קובע לבד" ? "תור לכמה אנשים ברצף: לא קובעים, כל אחד קובע בעצמו." : v === "רק אם שואלים" ? "תור לכמה אנשים ברצף: רק אם הלקוח ביקש, אל תציע מיוזמתך." : "תור לכמה אנשים ברצף: אפשר, אחד אחרי השני.",
  },
  {
    key: "staffFull", label: "כשהמבוקש מלא", group: "כללים ופרטים", core: false, type: "choice",
    options: v => [`להציע ${v.staff} ${v.other}`, "רשימת המתנה", "לשאול מה עדיף"], default: () => "לשאול מה עדיף",
    question: v => `${v.staffDef} ש${v.customer} ${v.customerFem ? "ביקשה" : "ביקש"} ${v.staffFem ? "מלאה" : "מלא"}. מה עושים? ${v.staff} ${v.other} / רשימת המתנה / לשאול`,
    compile: (v, voc) => `כש${voc.staffDef} ${voc.staffFem ? "המבוקשת מלאה" : "המבוקש מלא"}: ${v}.`,
  },
  {
    key: "lateTolerance", label: "איחור", group: "כללים ופרטים", core: false, type: "choice",
    options: v => ["5 דקות", "10 דקות", "15 דקות", `תלוי ב${v.staff}`], default: () => "10 דקות",
    question: v => `כמה דקות איחור זה בסדר לפני שהתור הולך? 5 / 10 / 15 / תלוי ב${v.staff}`,
    compile: (v, voc) => String(v).startsWith("תלוי ב") ? `איחור: תלוי ב${voc.staff}. עדכן ${voc.staffFem ? "אותה" : "אותו"} ואל תבטיח.` : `איחור מקובל: עד ${v}. מעבר לזה עדכן את ${voc.staffDef} ואל תבטיח שהתור נשמר.`,
  },
  {
    key: "staffRules", label: v => `כללים ל${v.staff} ${v.staffFem ? "מסוימת" : "מסוים"}`, group: "כללים ופרטים", core: false, type: "text", multiline: true,
    question: v => v.staffFem ? `יש ${v.staff} עם שעות מיוחדות או טיפול שרק היא עושה? שורה לכל אחת (למשל: נועה מתחילה ב־10:00, רק שירן עושה בנייה)` : `יש ${v.staff} עם שעות מיוחדות או שירות שרק הוא עושה? שורה לכל אחד (למשל: מוטי מתחיל ב־10:00, רק דני עושה צבע)`,
    compile: (v, voc) => `כללים לפי ${voc.staff}: ${String(v).split(/\n+/).map(x => x.trim()).filter(Boolean).slice(0, 10).join("; ")}.`,
  },
  {
    key: "businessRules", label: "כללים של העסק", group: "כללים ופרטים", core: false, type: "text", multiline: true,
    question: () => "דברים קטנים שהסוכן צריך לדעת, שורה לכל כלל (למשל: בשישי עד 14:00 רק תספורות, יש חניה כחול לבן ברחוב)",
    compile: v => `כללים של העסק (כשיש סתירה, הם גוברים על הכללים הכלליים): ${String(v).split(/\n+/).map(x => x.trim()).filter(Boolean).slice(0, 20).join("; ")}.`,
  },

  // ── D2. Style, in the owner's own words (the wizard's "short talk" field) ──
  {
    key: "styleNotes", label: "הסגנון שלך במילים", group: "זהות וטון", core: false, type: "text", multiline: true,
    question: v => `ספר בכמה מילים על הסגנון של ${v.placeDef} ומה חשוב לך שהסוכן ידע (למשל: "אנחנו משפחתיים, מדברים בגובה העיניים, לא מזכירים מבצעים")`,
    compile: v => `סגנון העסק במילים של בעל העסק: ${v}`,
  },
  {
    // Real messages the owner sends — the agent copies the voice, never the content.
    key: "styleSamples", label: "הודעות לדוגמה", group: "זהות וטון", core: false, type: "text", multiline: true,
    question: () => "הדבק 2–3 הודעות אמיתיות ששלחת ללקוחות בוואטסאפ, כל אחת בשורה נפרדת (כדי שהסוכן ידבר כמוך)",
    compile: v => `ככה בעל העסק כותב ללקוחות (חקה את הקול והאורך, לא את התוכן): ${String(v).split(/\n+/).map(x => x.trim()).filter(Boolean).slice(0, 4).map(x => `«${x.slice(0, 220)}»`).join(" ")}`,
  },

  // ── E. Escalation (text part; the phone number is a system toggle elsewhere) ──
  {
    key: "escalateWhen", label: "מתי להעביר לאדם", group: "הסלמה", core: true, type: "text",
    default: v => `כש${v.customer} ${v.customerFem ? "מבקשת" : "מבקש"} לדבר עם אדם, או כשאתה תקוע ולא מצליח לעזור`,
    question: v => `מתי להעביר את השיחה לאדם אמיתי? (ברירת מחדל: כש${v.customer} ${v.customerFem ? "מבקשת" : "מבקש"}, או כשאתה תקוע)`,
    compile: v => `מתי להעביר לטיפול אנושי: ${v}.`,
  },
];

/**
 * What each question changes, in plain words, for the "?" next to it on the
 * setup screens (14.10.2026, Yair: "שיהיה הסברים על כל דבר"). Only what the
 * field really does: most of them are lines the agent reads, not rules the
 * system enforces.
 */
const FIELD_HELP: Record<string, (v: Vocab) => string> = {
  tone: () => "איך הסוכן נשמע. רשמי: \"שלום, איך אפשר לעזור?\". חברי: \"היי, מתי נוח לך?\". קליל-רחוב: \"מה המצב? בוא נסגור לך תור\".",
  emojis: () => "כמה סמיילים בהודעות של הסוכן. מעט זה אחד פה ושם, כמו שבן אדם כותב.",
  address: v => `איך הסוכן פונה ל${v.customer} בהודעה. בשם פרטי: \"היי יוסי\". ניטרלי: בלי פנייה בכלל.`,
  defaultService: v => `כש${v.customer} ${v.customerFem ? "כותבת" : "כותב"} רק \"רוצה תור\" בלי לפרט, זה השירות שהסוכן יקבע. מזה נקבע גם אורך התור ביומן.`,
  barberAssign: v => `הכי ${v.free}: הסוכן קובע אצל מי שפנוי, בלי לשאול. לשאול: הסוכן שואל אצל מי נוח. ${v.staff} ${v.staffFem ? "קבועה" : "קבוע"}: אצל מי שעשה לו בפעם הקודמת, בלי לשאול.`,
  priceNote: v => `רק אם כל ${v.staff} גובה מחיר אחר. מה הסוכן אומר כששואלים \"כמה עולה\" לפני שבחרו אצל מי.`,
  cancelPolicy: v => `מה הסוכן עונה ל${v.customer} ${v.customerFem ? "ששואלת" : "ששואל"} עד מתי אפשר לבטל תור.`,
  deposit: () => "אם כן, הסוכן יגיד ללקוח שיש מקדמה כשהוא קובע תור.",
  walkin: () => "מה הסוכן עונה למי ששואל אם אפשר לבוא בלי לקבוע מראש.",
  location: () => "הסוכן שולח את זה למי ששואל איך מגיעים או איפה חונים.",
  payment: () => "מה הסוכן עונה למי ששואל איך משלמים.",
  kids: v => v.type === "barber_men" ? "מה הסוכן עונה כששואלים על תספורת לילד: מאיזה גיל ובכמה." : v.type === "barber_women" ? "מה הסוכן עונה כששואלים על תספורת לילדה: מאיזה גיל ובכמה." : v.type === "other" ? "מה הסוכן עונה כששואלים על ילדים או קטינים: מאיזה גיל ואם צריך אישור הורה." : "מה הסוכן עונה כששואלים על טיפול לקטינה: מאיזה גיל ואם צריך אישור הורה.",
  groupBooking: v => `למשל ${v.customerFem ? "אמא ובת" : "אבא וילד"}: האם הסוכן קובע להם תורים צמודים, אחד אחרי השני.`,
  staffFull: v => `מה הסוכן עושה כש${v.staffDef} ש${v.customer} ${v.customerFem ? "ביקשה תפוס בזמן שהיא רוצה" : "ביקש תפוס בזמן שהוא רוצה"}.`,
  lateTolerance: v => `מה הסוכן עונה ל${v.customer} ${v.customerFem ? "שכותבת שהיא מאחרת" : "שכותב שהוא מאחר"}: עד כמה זה בסדר.`,
  staffRules: v => `דברים שנכונים רק ל${v.staff} אחד, כדי שהסוכן לא יקבע טעות. שורה לכל ${v.staff}.`,
  businessRules: () => "כל דבר קטן שאתה היית עונה ללקוח, והסוכן לא יכול לנחש לבד.",
  styleNotes: () => "כמה מילים חופשיות על האווירה אצלכם. הסוכן מתאים את עצמו אליה.",
  styleSamples: () => "הודעות אמיתיות שכתבת ללקוחות. הסוכן לומד מהן איך אתה כותב.",
  escalateWhen: () => "מתי הסוכן מפסיק לענות ומעביר את השיחה אליך. אתה מקבל התראה וממשיך משם בעצמך.",
};

/** The interview for one business type: the specs that apply to it, with the
 *  vocabulary folded into questions, options, defaults and compiled lines. */
export function setupFieldsFor(type: BusinessType | string | null | undefined, vocab?: Vocab): SetupField[] {
  const v = vocab ?? vocabFor(type);
  return SETUP_FIELD_SPECS
    .filter(f => !f.verticals || f.verticals.includes(v.type))
    .map(f => ({
      key: f.key, label: typeof f.label === "function" ? f.label(v) : f.label, group: f.group, type: f.type, core: f.core,
      question: f.questionByType?.[v.type] ?? f.question(v),
      options: f.options?.(v),
      multiline: f.multiline,
      help: FIELD_HELP[f.key]?.(v),
      default: f.default?.(v),
      compile: (value: string | boolean) => f.compile(value, v),
    }));
}

/** The barber_men interview — what DOMINANT-era code imported as "the" fields.
 *  Callers that know the business type should use setupFieldsFor(). */
export const SETUP_FIELDS: SetupField[] = setupFieldsFor("barber_men");

/** Keys of the fields that must be answered before going live (same for every type). */
export const CORE_FIELD_KEYS = SETUP_FIELD_SPECS.filter(f => f.core).map(f => f.key);

export type SetupConfig = Record<string, string | boolean>;

/** Core fields still missing a value — empty array means "ready to go live". */
export function missingCoreFields(cfg: SetupConfig | null | undefined, type?: BusinessType | string | null): SetupField[] {
  const c = cfg ?? {};
  return setupFieldsFor(type).filter(f => f.core && (c[f.key] === undefined || c[f.key] === ""));
}

/** Every field still unanswered (core + optional), in ask-order. */
export function unansweredFields(cfg: SetupConfig | null | undefined, type?: BusinessType | string | null): SetupField[] {
  const c = cfg ?? {};
  return setupFieldsFor(type).filter(f => c[f.key] === undefined || c[f.key] === "");
}

/**
 * Render the shop's answered fields into a compact Hebrew prompt block. Returns
 * "" when nothing is set — so a brand-new shop adds nothing until the interview
 * has run. Only answered fields contribute a line; unanswered optionals fall back
 * to the shared brain's own defaults. With `skipTemplateKeys` the keys the
 * compact template renders itself (default service, address style) are left out.
 */
export function compileSetupConfig(cfg: SetupConfig | null | undefined, vocab?: Vocab, o?: { skipTemplateKeys?: boolean }): string {
  const c = cfg ?? {};
  const lines: string[] = [];
  for (const f of setupFieldsFor(vocab?.type, vocab)) {
    if (o?.skipTemplateKeys && TEMPLATE_CONSUMED_SETUP_KEYS.has(f.key)) continue;
    const v = c[f.key];
    if (v === undefined || v === "") continue;
    const line = f.compile(v);
    if (line) lines.push(`- ${line}`);
  }
  if (!o?.skipTemplateKeys && typeof c.platformNotes === "string" && c.platformNotes.trim()) {
    lines.push(`- דברים ייחודיים לעסק הזה (גוברים על הכללים הכלליים): ${c.platformNotes.split(/\n+/).map(x => x.trim().replace(/^[-•]\s*/, "")).filter(Boolean).slice(0, 12).join("; ")}`);
  }
  if (!lines.length) return "";
  return `הגדרות ספציפיות של העסק הזה (כבד אותן):\n${lines.join("\n")}`;
}
