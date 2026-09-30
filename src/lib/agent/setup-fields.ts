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
import { TEMPLATE_CONSUMED_SETUP_KEYS } from "@/lib/agent/prompt-template";

export type SetupFieldType = "choice" | "text" | "bool";

/** One interview field, already resolved for a business type (words, options,
 *  defaults) — what the owner agent and the compiler work with. */
export type SetupField = {
  /** Stored key inside AgentConfig.setupConfig (JSON). */
  key: string;
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
  group: string;
  type: SetupFieldType;
  core: boolean;
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
    key: "tone", group: "זהות וטון", core: false, type: "choice",
    options: () => ["רשמי", "חברי", "קליל-רחוב"], default: () => "חברי",
    question: () => "איזה טון מתאים לך מול לקוחות? רשמי / חברי / קליל-רחוב",
    compile: v => `דבר בטון ${v}.`,
  },
  {
    key: "emojis", group: "זהות וטון", core: false, type: "choice",
    options: () => ["בלי", "מעט", "הרבה"], default: () => "מעט",
    question: () => "כמה אימוג'ים להשתמש בשיחות? בלי / מעט / הרבה",
    compile: v => v === "בלי" ? "אל תשתמש באימוג'ים." : v === "הרבה" ? "אפשר להשתמש באימוג'ים בחופשיות." : "השתמש במעט אימוג'ים, במידה.",
  },
  {
    // Decision #9 (docs/PLAN-MASTER.md): street slang only where it belongs — barber_men.
    key: "address", group: "זהות וטון", core: false, type: "choice",
    options: v => v.slangAllowed ? ["בשם פרטי", "אחי", "ניטרלי"] : ["בשם פרטי", "ניטרלי"], default: () => "בשם פרטי",
    question: v => v.slangAllowed ? "איך לפנות ללקוח? בשם פרטי / 'אחי' / ניטרלי" : `איך לפנות ל${v.customer}? בשם פרטי / ניטרלי`,
    compile: (v, voc) => v === "אחי" && voc.slangAllowed ? "פנה ללקוח ב'אחי'." : v === "ניטרלי" ? `פנה ל${voc.customer} בצורה ניטרלית, בלי שם.` : `פנה ל${voc.customer} בשם${voc.customerFem ? "ה" : "ו"} הפרטי.`,
  },

  // ── B. Booking defaults ──
  {
    key: "defaultService", group: "ברירות מחדל", core: true, type: "text",
    default: v => v.defaultService,
    question: v => `כש${v.customer} ${v.customerFem ? "כותבת" : "כותב"} 'רוצה תור' בלי לפרט — לאיזה שירות לקבוע כברירת מחדל? (למשל: ${v.serviceExamples})`,
    questionByType: { barber_men: "כשלקוח כותב 'רוצה תור' בלי לפרט — לאיזה שירות לקבוע כברירת מחדל? (רוב המספרות: תספורת + זקן)" },
    compile: (v, voc) => `כש${voc.customer} לא ${voc.customerFem ? "מציינת" : "מציין"} שירות, הנח ש${voc.customerFem ? "היא רוצה" : "הוא רוצה"}: ${v}.`,
  },
  {
    key: "barberAssign", group: "ברירות מחדל", core: true, type: "choice",
    options: v => ["הכי פנוי", "לשאול", `${v.staff} ${v.staffFem ? "קבועה" : "קבוע"}`],
    question: v => `כש${v.customer} לא ${v.customerFem ? "מבקשת" : "מבקש"} ${v.staff} ${v.staffFem ? "מסוימת" : "מסוים"} — איך לשבץ? הכי-${v.free} / לשאול ${v.customerFem ? "אותה" : "אותו"} / ${v.staff} ${v.staffFem ? "קבועה" : "קבוע"}`,
    compile: (v, voc) => {
      const c = voc.customer, him = voc.customerFem ? "אותה" : "אותו", his = voc.customerFem ? "היא מעדיפה" : "הוא מעדיף";
      const notAsking = `כש${c} לא ${voc.customerFem ? "מבקשת" : "מבקש"} ${voc.staff}`;
      if (v === "לשאול") return `${notAsking}, שאל ${him} אצל מי ${his}.`;
      if (typeof v === "string" && v.startsWith(voc.staff)) return `${notAsking}, שבץ ${him} אצל ${voc.staffDef} ${voc.main}.`;
      return `${notAsking}, שבץ ${him} בשקט אצל ${voc.staffDef} ${voc.staffFem ? "הפנויה" : "הפנוי"} ביותר.`;
    },
  },

  // ── C. Policy ──
  {
    key: "cancelPolicy", group: "מדיניות", core: false, type: "text",
    default: () => "עד שעתיים לפני התור",
    question: () => "עד כמה זמן לפני התור מותר לבטל בלי בעיה? (ברירת מחדל: עד שעתיים לפני)",
    compile: v => `מדיניות ביטול: אפשר לבטל ${v}.`,
  },
  {
    key: "deposit", group: "מדיניות", core: false, type: "bool", default: () => false,
    question: () => "גובים מקדמה על תור? כן / לא",
    compile: (v, voc) => v === true ? `יש לגבות מקדמה על תור — אם ${voc.customer} ${voc.customerFem ? "שואלת" : "שואל"}, ציין זאת.` : "",
  },
  {
    key: "walkin", group: "מדיניות", core: false, type: "bool", default: () => true,
    question: v => `מקבלים ${v.customer} בלי תור מראש (walk-in)? כן / לא`,
    compile: v => v === false ? "לא מקבלים לקוחות ללא תור מראש — צריך לקבוע." : "אפשר להגיע גם בלי תור מראש.",
  },

  // ── D. Logistics & FAQ ──
  {
    key: "location", group: "לוגיסטיקה", core: false, type: "text",
    question: v => `איפה בדיוק ${v.placeDef}? קומה, כניסה, חניה — מה כדאי שאגיד ללקוחות?`,
    compile: v => `מיקום והגעה: ${v}.`,
  },
  {
    key: "payment", group: "לוגיסטיקה", core: false, type: "text",
    default: () => "מזומן, אשראי וביט",
    question: () => "אמצעי תשלום? מזומן / אשראי / ביט / הכל",
    compile: v => `אמצעי תשלום מקובלים: ${v}.`,
  },

  // ── D2. Style, in the owner's own words (the wizard's "short talk" field) ──
  {
    key: "styleNotes", group: "זהות וטון", core: false, type: "text",
    question: v => `ספר בכמה מילים על הסגנון של ${v.placeDef} ומה חשוב לך שהסוכן ידע (למשל: "אנחנו משפחתיים, מדברים בגובה העיניים, לא מזכירים מבצעים")`,
    compile: v => `סגנון העסק במילים של בעל העסק: ${v}`,
  },

  // ── E. Escalation (text part; the phone number is a system toggle elsewhere) ──
  {
    key: "escalateWhen", group: "הסלמה", core: true, type: "text",
    default: v => `כש${v.customer} ${v.customerFem ? "מבקשת" : "מבקש"} לדבר עם אדם, או כשאתה תקוע ולא מצליח לעזור`,
    question: v => `מתי להעביר את השיחה לאדם אמיתי? (ברירת מחדל: כש${v.customer} ${v.customerFem ? "מבקשת" : "מבקש"}, או כשאתה תקוע)`,
    compile: v => `מתי להעביר לטיפול אנושי: ${v}.`,
  },
];

/** The interview for one business type: the specs that apply to it, with the
 *  vocabulary folded into questions, options, defaults and compiled lines. */
export function setupFieldsFor(type: BusinessType | string | null | undefined, vocab?: Vocab): SetupField[] {
  const v = vocab ?? vocabFor(type);
  return SETUP_FIELD_SPECS
    .filter(f => !f.verticals || f.verticals.includes(v.type))
    .map(f => ({
      key: f.key, group: f.group, type: f.type, core: f.core,
      question: f.questionByType?.[v.type] ?? f.question(v),
      options: f.options?.(v),
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
  if (!lines.length) return "";
  return `הגדרות ספציפיות של העסק הזה (כבד אותן):\n${lines.join("\n")}`;
}
