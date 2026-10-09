"use client";

/**
 * The shop's way to shape its agent (spec "תפעול והגדרת הסוכן", 10.10.2026):
 * multiple-choice and short open questions instead of a free prompt. Every
 * answer replaces its own section of the base prompt (prompt-template.ts);
 * an unanswered question keeps the base wording. Saved with the page's
 * "שמור", versioned in AgentSetupHistory, any version can be put back.
 */

export type SetupFieldDTO = {
  key: string; label: string; group: string; question: string; type: "choice" | "text" | "bool";
  options: string[] | null; default: string | boolean | null; core: boolean; multiline: boolean;
};
export type SetupHistoryDTO = { id: string; author: string; createdAt: string };
/** null = "back to the base wording" (deleted on save). */
export type Answers = Record<string, string | boolean | null>;

/** The question as a subtitle: without the "(hint)" tail and, when the
 *  options are shown as buttons anyway, without the "? a / b / c" list. */
function splitQuestion(q: string, hasButtons: boolean): { text: string; hint: string | null } {
  const m = q.match(/^(.*?)\s*\((.*)\)\s*$/);
  let text = m ? m[1] : q;
  if (hasButtons) text = text.replace(/\?\s*[^?]*\/[^?]*$/, "?");
  return { text, hint: m ? m[2] : null };
}

const chip = (on: boolean) =>
  `px-3 py-1.5 rounded-full text-sm border transition ${on ? "bg-teal-600 border-teal-600 text-white" : "bg-white border-neutral-200 text-neutral-700 hover:bg-neutral-50"}`;

export default function AgentSetupCard({ fields, answers, onChange, history, onRestore, restoring, hasCustomPrompt }: {
  fields: SetupFieldDTO[];
  answers: Answers;
  onChange: (key: string, value: string | boolean | null) => void;
  history: SetupHistoryDTO[];
  onRestore: (id: string) => void;
  restoring: string | null;
  hasCustomPrompt: boolean;
}) {
  const groups = Array.from(new Set(fields.map(f => f.group)));
  const answered = (k: string) => answers[k] !== undefined && answers[k] !== null && answers[k] !== "";
  const missingCore = fields.filter(f => f.core && !answered(f.key));

  return (
    <div className="bg-white rounded-2xl border border-neutral-200 p-5 space-y-5">
      <div>
        <h2 className="font-semibold text-neutral-800">איך הסוכן מדבר ועובד</h2>
        <p className="text-xs text-neutral-500 mt-0.5 leading-relaxed">
          הבסיס כבר כתוב ונבדק על שיחות אמיתיות. כאן רק מה שמשתנה מעסק לעסק: כל תשובה מחליפה את החלק שלה בהנחיות של הסוכן. שאלה בלי תשובה נשארת כמו בבסיס.
        </p>
        {hasCustomPrompt && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mt-2">
            הסוכן של העסק הזה מוגדר ידנית על ידי צוות צ&apos;אטור, אז התשובות כאן מתווספות להנחיות שלו.
          </p>
        )}
        {missingCore.length > 0 && (
          <p className="text-xs text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mt-2">
            חסרות {missingCore.length} תשובות חובה לפני שהסוכן עולה לאוויר: {missingCore.map(f => f.label).join(" · ")}
          </p>
        )}
      </div>

      {groups.map(g => (
        <section key={g} className="space-y-4">
          <h3 className="text-xs font-semibold text-neutral-400 tracking-wide">{g}</h3>
          {fields.filter(f => f.group === g).map(f => {
            const { text, hint } = splitQuestion(f.question, f.type !== "text");
            const has = answered(f.key);
            const shown = has ? answers[f.key] : f.default;
            return (
              <div key={f.key} className="space-y-1.5">
                <div className="text-sm font-semibold text-neutral-800">
                  {f.label}
                  {f.core && !has && <span className="text-[11px] font-semibold text-red-600 mr-2">חובה</span>}
                </div>
                <p className="text-xs text-neutral-500 leading-relaxed">{text}</p>
                {hint && <p className="text-[11px] text-neutral-400 leading-relaxed">{hint}</p>}
                {f.type === "choice" && f.options ? (
                  <div className="flex flex-wrap gap-1.5">
                    {f.options.map(o => (
                      <button key={o} type="button" onClick={() => onChange(f.key, o)} className={chip(shown === o)} style={!has && shown === o ? { opacity: 0.7 } : undefined}>{o}</button>
                    ))}
                  </div>
                ) : f.type === "bool" ? (
                  <div className="flex gap-1.5">
                    {[true, false].map(v => (
                      <button key={String(v)} type="button" onClick={() => onChange(f.key, v)} className={chip(shown === v)} style={!has && shown === v ? { opacity: 0.7 } : undefined}>{v ? "כן" : "לא"}</button>
                    ))}
                  </div>
                ) : f.multiline ? (
                  <textarea
                    value={typeof answers[f.key] === "string" ? String(answers[f.key]) : ""}
                    onChange={e => onChange(f.key, e.target.value)}
                    rows={f.key === "styleSamples" ? 4 : 3}
                    className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
                    placeholder={f.key === "styleSamples" ? "הודעה אחת בכל שורה" : "כמה מילים בסגנון שלך"}
                  />
                ) : (
                  <input
                    value={typeof answers[f.key] === "string" ? String(answers[f.key]) : ""}
                    onChange={e => onChange(f.key, e.target.value)}
                    className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
                    placeholder={typeof f.default === "string" ? f.default : ""}
                  />
                )}
                {!has && f.type !== "text" && f.default !== null && <p className="text-[11px] text-neutral-400">עדיין לא נבחר, כרגע עובד לפי ברירת המחדל</p>}
                {has && f.type !== "text" && (
                  <button type="button" onClick={() => onChange(f.key, null)} className="text-[11px] text-neutral-400 hover:text-neutral-600">חזרה לבסיס</button>
                )}
              </div>
            );
          })}
        </section>
      ))}

      {history.length > 0 && (
        <details className="rounded-xl border border-neutral-200 px-3 py-2">
          <summary className="text-sm font-medium text-neutral-700 cursor-pointer">גרסאות קודמות ({history.length})</summary>
          <ul className="mt-2 space-y-1.5">
            {history.map((h, i) => (
              <li key={h.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="text-neutral-600">
                  {new Date(h.createdAt).toLocaleString("he-IL", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })} · {h.author}
                  {i === 0 && <span className="text-[11px] text-teal-700 mr-2">נוכחית</span>}
                </span>
                {i > 0 && (
                  <button type="button" onClick={() => onRestore(h.id)} disabled={!!restoring} className="text-xs px-2.5 py-1 rounded-lg border border-neutral-200 hover:bg-neutral-50 disabled:opacity-50">
                    {restoring === h.id ? "משחזר…" : "שחזר"}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
