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

export type SetupFieldType = "choice" | "text" | "bool";

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

/**
 * The prompt-shaping questions, in ask-order. System-toggle questions (swap
 * approval, waitlist, reminders, reengage, escalation phone, booking horizon)
 * are handled against their own columns and are intentionally NOT here.
 */
export const SETUP_FIELDS: SetupField[] = [
  // ── A. Identity & tone ──
  {
    key: "tone", group: "זהות וטון", core: false, type: "choice",
    options: ["רשמי", "חברי", "קליל-רחוב"], default: "חברי",
    question: "איזה טון מתאים לך מול לקוחות? רשמי / חברי / קליל-רחוב",
    compile: v => `דבר בטון ${v}.`,
  },
  {
    key: "emojis", group: "זהות וטון", core: false, type: "choice",
    options: ["בלי", "מעט", "הרבה"], default: "מעט",
    question: "כמה אימוג'ים להשתמש בשיחות? בלי / מעט / הרבה",
    compile: v => v === "בלי" ? "אל תשתמש באימוג'ים." : v === "הרבה" ? "אפשר להשתמש באימוג'ים בחופשיות." : "השתמש במעט אימוג'ים, במידה.",
  },
  {
    key: "address", group: "זהות וטון", core: false, type: "choice",
    options: ["בשם פרטי", "אחי", "ניטרלי"], default: "בשם פרטי",
    question: "איך לפנות ללקוח? בשם פרטי / 'אחי' / ניטרלי",
    compile: v => v === "אחי" ? "פנה ללקוח ב'אחי'." : v === "ניטרלי" ? "פנה ללקוח בצורה ניטרלית, בלי שם." : "פנה ללקוח בשמו הפרטי.",
  },

  // ── B. Booking defaults ──
  {
    key: "defaultService", group: "ברירות מחדל", core: true, type: "text",
    default: "תספורת + זקן",
    question: "כשלקוח כותב 'רוצה תור' בלי לפרט — לאיזה שירות לקבוע כברירת מחדל? (רוב המספרות: תספורת + זקן)",
    compile: v => `כשלקוח לא מציין שירות, הנח שהוא רוצה: ${v}.`,
  },
  {
    key: "barberAssign", group: "ברירות מחדל", core: true, type: "choice",
    options: ["הכי פנוי", "לשאול", "ספר קבוע"],
    question: "כשלקוח לא מבקש ספר מסוים — איך לשבץ? הכי-פנוי / לשאול אותו / ספר קבוע",
    compile: v => v === "לשאול" ? "כשלקוח לא מבקש ספר, שאל אותו אצל מי הוא מעדיף." : v === "ספר קבוע" ? "כשלקוח לא מבקש ספר, שבץ אותו אצל הספר הראשי." : "כשלקוח לא מבקש ספר, שבץ אותו בשקט אצל הספר הפנוי ביותר.",
  },

  // ── C. Policy ──
  {
    key: "cancelPolicy", group: "מדיניות", core: false, type: "text",
    default: "עד שעתיים לפני התור",
    question: "עד כמה זמן לפני התור מותר לבטל בלי בעיה? (ברירת מחדל: עד שעתיים לפני)",
    compile: v => `מדיניות ביטול: אפשר לבטל ${v}.`,
  },
  {
    key: "deposit", group: "מדיניות", core: false, type: "bool", default: false,
    question: "גובים מקדמה על תור? כן / לא",
    compile: v => v === true ? "יש לגבות מקדמה על תור — אם לקוח שואל, ציין זאת." : "",
  },
  {
    key: "walkin", group: "מדיניות", core: false, type: "bool", default: true,
    question: "מקבלים לקוח בלי תור מראש (walk-in)? כן / לא",
    compile: v => v === false ? "לא מקבלים לקוחות ללא תור מראש — צריך לקבוע." : "אפשר להגיע גם בלי תור מראש.",
  },

  // ── D. Logistics & FAQ ──
  {
    key: "location", group: "לוגיסטיקה", core: false, type: "text",
    question: "איפה בדיוק המספרה? קומה, כניסה, חניה — מה כדאי שאגיד ללקוחות?",
    compile: v => `מיקום והגעה: ${v}.`,
  },
  {
    key: "payment", group: "לוגיסטיקה", core: false, type: "text",
    default: "מזומן, אשראי וביט",
    question: "אמצעי תשלום? מזומן / אשראי / ביט / הכל",
    compile: v => `אמצעי תשלום מקובלים: ${v}.`,
  },

  // ── E. Escalation (text part; the phone number is a system toggle elsewhere) ──
  {
    key: "escalateWhen", group: "הסלמה", core: true, type: "text",
    default: "כשהלקוח מבקש לדבר עם אדם, או כשאתה תקוע ולא מצליח לעזור",
    question: "מתי להעביר את השיחה לאדם אמיתי? (ברירת מחדל: כשהלקוח מבקש, או כשאתה תקוע)",
    compile: v => `מתי להעביר לטיפול אנושי: ${v}.`,
  },
];

/** Keys of the fields that must be answered before going live. */
export const CORE_FIELD_KEYS = SETUP_FIELDS.filter(f => f.core).map(f => f.key);

export type SetupConfig = Record<string, string | boolean>;

/** Core fields still missing a value — empty array means "ready to go live". */
export function missingCoreFields(cfg: SetupConfig | null | undefined): SetupField[] {
  const c = cfg ?? {};
  return SETUP_FIELDS.filter(f => f.core && (c[f.key] === undefined || c[f.key] === ""));
}

/** Every field still unanswered (core + optional), in ask-order. */
export function unansweredFields(cfg: SetupConfig | null | undefined): SetupField[] {
  const c = cfg ?? {};
  return SETUP_FIELDS.filter(f => c[f.key] === undefined || c[f.key] === "");
}

/**
 * Render the shop's answered fields into a compact Hebrew prompt block. Returns
 * "" when nothing is set — so a brand-new shop adds nothing until the interview
 * has run. Only answered fields contribute a line; unanswered optionals fall back
 * to the shared brain's own defaults.
 */
export function compileSetupConfig(cfg: SetupConfig | null | undefined): string {
  const c = cfg ?? {};
  const lines: string[] = [];
  for (const f of SETUP_FIELDS) {
    const v = c[f.key];
    if (v === undefined || v === "") continue;
    const line = f.compile(v);
    if (line) lines.push(`- ${line}`);
  }
  if (!lines.length) return "";
  return `הגדרות ספציפיות של העסק הזה (כבד אותן):\n${lines.join("\n")}`;
}
