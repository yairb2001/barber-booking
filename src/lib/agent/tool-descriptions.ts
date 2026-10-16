/**
 * Tool descriptions for the customer agent — the short, sharp wording that went
 * live in stage B of docs/PLAN-COST.md (10,466 → 6,126 chars of tool JSON,
 * measured on real replays with no behavior regressions). Applied to the tool
 * definitions in customer-agent.ts (same names, same schemas). The pre-stage-B
 * wording lives in git history (commit 89b3845 and earlier).
 */
import type { Vocab } from "@/lib/vocab";
/** Same names and schemas as AGENT_TOOLS — only the wording is shorter. */
export const TOOL_DESCRIPTIONS: Record<string, { description: string; params?: Record<string, string> }> = {
  get_services: {
    description: "רשימת השירותים עם מחיר ומשך. כבר כתובה בהנחיות (כולל המחיר של כל ספר) — קרא רק אם היא חסרה שם.",
    params: { staffId: "מזהה ספר (אופציונלי) — המחירים המותאמים שלו" },
  },
  get_staff_list: { description: "רשימת הספרים והמזהים. כבר כתובה בהנחיות — קרא רק אם היא חסרה שם." },
  get_available_slots: {
    description: "שעות פנויות בתאריך. בלי ספר — לכל הספרים, שורה לכל ספר.",
    params: { date: "YYYY-MM-DD", staffId: "מזהה ספר (אופציונלי)", serviceId: "מזהה שירות (אופציונלי)" },
  },
  find_next_available: {
    description: "התאריך הפנוי הקרוב (סורק עד 30 יום) והשעות בו. ל\"הכי קרוב\" / \"מתי יש מקום\", במקום לבדוק יום-יום. הלקוח דחה תאריך ורוצה מאוחר יותר → afterDate = התאריך שנדחה.",
    params: { staffId: "מזהה ספר (אופציונלי)", serviceId: "מזהה שירות (אופציונלי)", afterDate: "YYYY-MM-DD — לסרוק מהיום שאחריו (אופציונלי)" },
  },
  find_parallel_slots: {
    description: "שעות שבהן כמה ספרים פנויים באותה שעה בדיוק, כל שעה עם הספרים שפנויים בה. רק לקביעה לכמה אנשים ביחד/במקביל; צמד ספר+שעה למקביליות תקף רק מכאן. אם הלקוח כבר נתן שעה שונה לכל אדם — זו לא מקביליות, קבע כל אחד בנפרד. בלי date — היום הקרוב שיש בו שעה כזו.",
    params: { date: "YYYY-MM-DD (אופציונלי)", count: "כמה ספרים צריכים להיות פנויים יחד (מספר האנשים). ברירת מחדל 2.", serviceId: "מזהה שירות (אופציונלי)" },
  },
  book_appointment: {
    description: "קובע תור. רק אחרי שהלקוח אישר את הפרטים.",
    params: {
      staffId: "מזהה הספר", serviceId: "מזהה השירות", date: "YYYY-MM-DD", startTime: "HH:MM",
      customerName: "שם מלא. לקוח רשום — השם הרשום כפי שהוא. לקוח חדש — רק אם כבר כתב שם מלא; אחרת השאר ריק והמערכת תשאל אותו.",
      note: "רק כשהתור עבור מישהו אחר: 'התור בפועל עבור: <שם>'. התור נשאר על הכרטיס של מי שמתכתב.",
    },
  },
  check_appointment: { description: "התורים הקרובים של הלקוח שמתכתב עכשיו (הטלפון ידוע, אין צורך לבקש)." },
  cancel_appointment: { description: "מבטל תור לפי מזהה, אחרי אישור הלקוח.", params: { appointmentId: "מזהה התור" } },
  get_business_info: { description: "כתובת, טלפון ושעות פעילות של העסק." },
  request_appointment_move: {
    description: "מעביר תור קיים ליום/שעה שביקש, במקום ביטול וקביעה מחדש. appointmentId מ-check_appointment. קרא רק אחרי שהלקוח אישר במפורש את היעד ('להזיז ל-12:00?' → 'כן'). פנוי → מעביר; לא קפדן על ספר או לקוח חדש → allowOtherBarber=true מאפשר ספר אחר; תפוס → מחזיר זמנים פנויים קרובים וגם אפשרות החלפה עם הלקוח שבאותה שעה (באישור הספר ושלו). הצג את שתי האפשרויות יחד, פעם אחת, במילים שחזרו. בחר זמן → קרא שוב איתו; מעדיף החלפה או עונה 'תנסה'/'תבדוק' → insistExactTime=true.",
    params: {
      appointmentId: "מזהה התור הקיים (מ-check_appointment)", targetDate: "YYYY-MM-DD", targetStartTime: "HH:MM",
      allowOtherBarber: "true אם לא אכפת לו אצל מי (או לקוח חדש בלי בקשה). ברירת מחדל false.",
      insistExactTime: "true כשבחר לנסות החלפה בשעה המדויקת שתפוסה. ברירת מחדל false.",
    },
  },
  report_running_late: {
    description: "לקוח שמאחר לתור של היום. רק אחרי שאמר כמה דקות בערך (אם לא — שאל קודם). appointmentId מ-check_appointment. מסור את הטקסט שחוזר מילה במילה; אל תבטיח שהאיחור אושר לפני תשובת הספר.",
    params: { appointmentId: "מזהה התור (מ-check_appointment)", delayMinutes: "כמה דקות בערך" },
  },
  join_waitlist: {
    description: "רושם לרשימת המתנה — הודעה אוטומטית אם יתפנה. לא במקום קביעה של שעה שכן פנויה. endDate כשגמיש בין ימים ('כל השבוע'); staffId רק אם רוצה ספר מסוים; לקוח חדש → customerName.",
    params: {
      serviceId: "מזהה השירות", date: "התאריך הרצוי (או הראשון בטווח) YYYY-MM-DD", endDate: "אופציונלי — סוף הטווח (כולל) YYYY-MM-DD",
      staffId: "מזהה ספר (אופציונלי — ריק = כל ספר)",
      preferredTimeOfDay: "'morning' | 'afternoon' | 'evening' | 'any' (ברירת מחדל; לקוח גמיש = any, אל תכריח לבחור)",
      customerName: "שם מלא — רק ללקוח חדש שאינו רשום",
    },
  },
  escalate_to_human: {
    description: "מעביר לטיפול אנושי ומתריע לספר או לבעל העסק. כשהלקוח מבקש אדם, מתלונן, או שאין דרך לעזור. staffId אם ברור על איזה ספר מדובר.",
    params: { reason: "מה הלקוח רוצה / מה השתבש, בקצרה — נשלח לספר", staffId: "מזהה ספר (אופציונלי)" },
  },
  propose_booking: {
    description: "מציע ללקוח את התור לאישור סופי. קרא כשיש ספר, שירות, יום ושעה; לקוח חדש בלי שם — המערכת שואלת אותו בעצמה. המערכת שולחת את שאלת האישור הקבועה, ואם הלקוח עונה כן — קובעת בעצמה ומודיעה לו. אתה לא כותב את שאלת האישור ולא קובע בעצמך.",
  },
  opt_out_of_messages: {
    description: "הלקוח לא רוצה הודעות יזומות ('הסר', 'תפסיקו לשלוח לי' — גם בלי המילה המדויקת). לא חוסם אותו: יכול לדבר ולקבוע, תזכורות לתור קיים ממשיכות, קביעה חדשה מבטלת את ההסרה.",
  },
};


export function applyToolDescriptions<T extends { name: string; description?: string; input_schema: unknown }>(tools: T[]): T[] {
  return tools.map((t, i) => {
    const trim = TOOL_DESCRIPTIONS[t.name];
    if (!trim) return t;
    const schema = JSON.parse(JSON.stringify(t.input_schema)) as { properties?: Record<string, { description?: string }> };
    for (const [k, v] of Object.entries(trim.params ?? {})) if (schema.properties?.[k]) schema.properties[k].description = v;
    // keep everything else (incl. the cache_control on the last tool) as is
    return { ...t, description: trim.description, input_schema: schema, ...(i === tools.length - 1 ? {} : {}) } as T;
  });
}

/**
 * The tools in the business's words (16.10.2026): a nail studio's agent reads
 * "מניקוריסטית", never "ספר", so it never says "ספר" to a customer. A men's
 * barbershop gets the tools untouched (same bytes, same prompt cache).
 */
export function toolsForType<T extends { name: string; description?: string; input_schema: unknown }>(tools: T[], v: Vocab): T[] {
  // Visits with several treatments are a beauty thing: a barbershop's tools stay as they were.
  if (v.type === "barber_men") return tools.filter(t => t.name !== "find_visit_times");
  const f = v.staffFem;
  const word = (w: string) => new RegExp(`(^|[^א-ת])${w}(?![א-ת])`, "g");
  const swap = (s: string) => s
    .split("כמה ספרים צריכים להיות פנויים").join(`כמה ${v.staffPlural} ${f ? "צריכות להיות פנויות" : "צריכים להיות פנויים"}`)
    .split("כמה ספרים פנויים").join(`כמה ${v.staffPlural} ${v.freePlural}`)
    .split("הספרים שפנויים").join(`${v.staffPluralDef} ש${v.freePlural}`)
    .split("ספר אחר").join(`${v.staff} ${v.other}`)
    .split("ספר מסוים").join(`${v.staff} ${f ? "מסוימת" : "מסוים"}`)
    .split("אותו ספר").join(`${f ? "אותה" : "אותו"} ${v.staff}`)
    .split("איזה ספר").join(`${f ? "איזו" : "איזה"} ${v.staff}`)
    .replace(word("הספרים"), (_m, p: string) => p + v.staffPluralDef)
    .replace(word("ספרים"), (_m, p: string) => p + v.staffPlural)
    .replace(word("הספר"), (_m, p: string) => p + v.staffDef)
    .replace(word("לספר"), (_m, p: string) => `${p}ל${v.staff}`)
    .replace(word("ספר"), (_m, p: string) => p + v.staff);
  const deep = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(deep);
    if (x && typeof x === "object") return Object.fromEntries(Object.entries(x).map(([k, val]) => [k, k === "description" && typeof val === "string" ? swap(val) : deep(val)]));
    return x;
  };
  return tools.map(t => {
    const out = { ...t, ...(t.description ? { description: swap(t.description) } : {}), input_schema: deep(t.input_schema) };
    // A visit: the further treatments of the same customer ride in "others" with their own serviceId.
    if (t.name === "propose_booking") {
      const sch = out.input_schema as { properties?: { others?: { items?: { properties?: Record<string, unknown>; required?: string[] } } } };
      const items = sch.properties?.others?.items;
      if (items?.properties) {
        items.properties.serviceId = { type: "string", description: "ביקור עם כמה טיפולים לאותה לקוחה: מזהה הטיפול הזה, כפי שחזר מ-find_visit_times (ואז בלי forName)." };
        items.required = ["startTime"];
      }
      out.description = `${out.description ?? ""} ביקור עם כמה טיפולים: others עם serviceId, staffId ו-startTime לכל טיפול נוסף, בדיוק כפי שחזרו מ-find_visit_times.`;
    }
    return out;
  });
}
