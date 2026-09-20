/**
 * Tool descriptions for the customer agent — the short, sharp wording that went
 * live in stage B of docs/PLAN-COST.md (10,466 → 6,126 chars of tool JSON,
 * measured on real replays with no behavior regressions). Applied to the tool
 * definitions in customer-agent.ts (same names, same schemas). The pre-stage-B
 * wording lives in git history (commit 89b3845 and earlier).
 */
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
      customerName: "שם מלא. לקוח רשום — השם הרשום כפי שהוא. לקוח חדש — פרטי + משפחה, נשאל רק בסוף, לפני הסגירה.",
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
