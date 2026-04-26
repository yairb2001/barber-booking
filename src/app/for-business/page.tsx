"use client";

import { useEffect, useState } from "react";

const GOLD = "#D4AF37";
const WA = "#25D366";

// ─── WhatsApp Chat Demo ───────────────────────────────────────────────────────

const CHAT_MSGS: { side: "right" | "left"; text: string }[] = [
  { side: "right", text: "היי, אפשר לקבוע תור?" },
  { side: "left",  text: "שלום! כמובן 😊\nלאיזה ספר תרצה?" },
  { side: "right", text: "אוריה בבקשה" },
  { side: "left",  text: "🗓 אוריה פנוי:\n• ראשון 14:00\n• שלישי 10:30\n• חמישי 16:00" },
  { side: "right", text: "ראשון 14:00 👍" },
  { side: "left",  text: "✅ קבוע!\nתספורת + זקן | אוריה\nראשון 14:00\n\nתזכורת תגיע יום לפני 🔔" },
];

function WaPhone() {
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (shown >= CHAT_MSGS.length) return;
    const delay = shown === 0 ? 700 : 1100;
    const t = setTimeout(() => setShown(s => s + 1), delay);
    return () => clearTimeout(t);
  }, [shown]);

  return (
    <div className="relative select-none mx-auto" style={{ width: 252 }}>
      {/* Ambient green glow */}
      <div className="absolute -inset-10 pointer-events-none rounded-full"
        style={{ background: `radial-gradient(ellipse at center, rgba(37,211,102,0.18) 0%, transparent 65%)` }} />

      {/* Phone shell */}
      <div className="relative overflow-hidden rounded-[2rem]"
        style={{ border: "1px solid rgba(255,255,255,0.09)", boxShadow: "0 30px 80px rgba(0,0,0,0.85)" }}>

        {/* WA header */}
        <div className="flex items-center gap-2.5 px-3 py-3" style={{ background: "#075E54" }}>
          <div className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-white text-base flex-shrink-0"
            style={{ background: WA }}>✂</div>
          <div>
            <p className="text-white text-[13px] font-semibold leading-tight">DOMINANT Bot</p>
            <p className="text-[11px] mt-0.5" style={{ color: "#a7f3c3" }}>פעיל 24/7 • מחובר</p>
          </div>
        </div>

        {/* Chat bubbles */}
        <div className="p-3 space-y-2.5 min-h-[290px] flex flex-col justify-end"
          style={{ background: "linear-gradient(180deg, #0B1519 0%, #0d1b20 100%)" }} dir="ltr">
          {CHAT_MSGS.slice(0, shown).map((m, i) => (
            <div key={i} className={`flex ${m.side === "right" ? "justify-end" : "justify-start"}`}>
              <div
                className="max-w-[80%] text-[12px] leading-relaxed whitespace-pre-line text-white/90 px-3 py-2"
                style={{
                  background: m.side === "right" ? "#005C4B" : "#1F2C34",
                  borderRadius: m.side === "right" ? "14px 14px 3px 14px" : "14px 14px 14px 3px",
                }}
              >{m.text}</div>
            </div>
          ))}
          {/* Typing dots */}
          {shown > 0 && shown < CHAT_MSGS.length && shown % 2 === 1 && (
            <div className="flex justify-start">
              <div className="px-3 py-3 rounded-[14px_14px_14px_3px]" style={{ background: "#1F2C34" }}>
                <div className="flex gap-1">
                  {[0, 1, 2].map(d => (
                    <span key={d} className="block w-1.5 h-1.5 rounded-full bg-white/35 animate-bounce"
                      style={{ animationDelay: `${d * 150}ms` }} />
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Input bar */}
        <div className="flex items-center gap-2 px-3 py-2.5" style={{ background: "#1F2C34" }}>
          <div className="flex-1 rounded-full h-8 px-3 flex items-center"
            style={{ background: "rgba(255,255,255,0.06)" }}>
            <span className="text-[11px] text-white/20">הודעה...</span>
          </div>
          <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs"
            style={{ background: WA }}>→</div>
        </div>
      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function Label({ text }: { text: string }) {
  return (
    <p className="text-[11px] font-bold tracking-[0.3em] uppercase mb-3" style={{ color: GOLD }}>
      {text}
    </p>
  );
}

function Hr() {
  return (
    <div className="py-1">
      <div className="h-px max-w-[120px] mx-auto" style={{ background: "rgba(212,175,55,0.18)" }} />
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ForBusinessPage() {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [sent, setSent] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!phone) return;
    const msg = encodeURIComponent(
      `שלום, אני ${name || "מעוניין"} לקבל הדגמה של מערכת DOMINANT. מספר טלפון: ${phone}`
    );
    // TODO: replace 972501234567 with real sales WhatsApp number
    window.open(`https://wa.me/972501234567?text=${msg}`, "_blank");
    setSent(true);
  }

  return (
    <div className="min-h-screen text-white" style={{ background: "#0D0D0D" }} dir="rtl">

      {/* ── NAV ─────────────────────────────────────────────────────── */}
      <nav className="sticky top-0 z-50 flex items-center justify-between px-5 py-4"
        style={{
          background: "rgba(13,13,13,0.92)",
          borderBottom: "1px solid rgba(255,255,255,0.05)",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
        }}>
        <p className="font-bold text-sm tracking-[0.25em] uppercase" style={{ color: GOLD, fontFamily: "var(--font-display)" }}>
          DOMINANT
        </p>
        <p className="text-zinc-600 text-[11px] tracking-[0.18em]">מערכת לספרים</p>
        <a href="#cta"
          className="text-[12px] font-bold px-4 py-2 rounded-full text-black transition-opacity hover:opacity-85"
          style={{ background: GOLD }}>
          קבע הדגמה
        </a>
      </nav>

      {/* ── HERO ────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden px-5 pt-14 pb-12 flex flex-col items-center text-center gap-8">
        {/* bg glow */}
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: "radial-gradient(ellipse at 50% 0%, rgba(212,175,55,0.10) 0%, transparent 55%)" }} />

        <div className="relative max-w-sm">
          <Label text="AI · ניהול מספרות · וואצאפ" />
          <h1 className="font-bold leading-[1.08] text-white mb-3"
            style={{ fontSize: "clamp(2.2rem, 9vw, 4rem)", fontFamily: "var(--font-display)" }}>
            המספרה שלך<br />
            <span style={{ color: GOLD }}>פועלת 24/7.</span>
          </h1>
          <p className="text-zinc-400 text-[15px] leading-relaxed mb-6">
            בוט וואצאפ שקובע תורים, מזיז, מחליף ומחזיר לקוחות —{" "}
            <span className="text-white font-semibold">בזמן שאתה עסוק בעבודה האמיתית שלך.</span>
          </p>
          <a href="#cta"
            className="inline-flex items-center gap-2 text-[14px] font-bold px-7 py-4 rounded-full text-black transition-transform hover:scale-105 active:scale-95"
            style={{ background: GOLD }}>
            רוצה לראות איך זה עובד?
            <span>←</span>
          </a>
          <p className="text-zinc-700 text-xs mt-3">15 דקות הדגמה · ללא התחייבות</p>
        </div>

        <WaPhone />
      </section>

      <Hr />

      {/* ── PAIN NUMBERS ────────────────────────────────────────────── */}
      <section className="px-5 py-14">
        <div className="text-center mb-8">
          <Label text="הבעיה" />
          <h2 className="text-2xl font-bold text-white">כמה לקוחות אתה מפספס?</h2>
        </div>
        <div className="grid grid-cols-1 gap-4 max-w-md mx-auto">
          {[
            {
              stat: "60%",
              label: "מהלקוחות לא חוזרים",
              detail: "הגיעו פעם אחת. היו מרוצים. נעלמו. לא כי מצאו מישהו אחר — כי אף אחד לא הזכיר להם לחזור.",
            },
            {
              stat: "47",
              label: "הודעות וואצאפ בשבוע שלא נענות",
              detail: "אמצע תספורת. מרטט. 'מתי יש פנוי?'. 'כמה עולה?'. תענה אחרי. ועד אז — הם הלכו למתחרה שענה.",
            },
            {
              stat: "₪400+",
              label: "שעה ריקה שניתן למלא",
              detail: "תור מבוטל ברגע האחרון. יש לקוחות שרצו אותה. לא ידעת. לא הספקת. כסף ישר על הרצפה.",
            },
          ].map(item => (
            <div key={item.stat} className="flex flex-col items-center text-center p-6 rounded-2xl"
              style={{ background: "#111", border: "1px solid rgba(255,255,255,0.06)" }}>
              <span className="text-[2.6rem] font-bold leading-none mb-2" style={{ color: GOLD, fontFamily: "var(--font-display)" }}>
                {item.stat}
              </span>
              <span className="text-white font-semibold text-sm mb-2">{item.label}</span>
              <span className="text-zinc-500 text-[12px] leading-relaxed">{item.detail}</span>
            </div>
          ))}
        </div>
      </section>

      <Hr />

      {/* ── PAIN STORIES ────────────────────────────────────────────── */}
      <section className="px-5 py-14">
        <div className="text-center mb-10">
          <Label text="מצבים שכל ספר מכיר" />
          <h2 className="text-2xl font-bold text-white">
            ספר, מזכיר, נציג שירות,{" "}
            <span style={{ color: GOLD }}>מנהל יומן.</span><br />
            כמה כובעים אתה חייב לחבוש?
          </h2>
        </div>
        <div className="space-y-4 max-w-md mx-auto">
          {[
            {
              icon: "👋",
              title: "הלקוח שלא חזר",
              body: "הוא היה מרוצה. אפילו אמר \'אבוא בחודש הבא\'. עברו 3 חודשים. עוד 6. כבר לא בא. לא כי מצא מישהו אחר — כי אף אחד לא שלח לו הודעה אחת.",
            },
            {
              icon: "📱",
              title: "הוואצאפ שלא מפסיק",
              body: "אמצע תספורת. מרטט. עוד הודעה. עוד אחת. \'מתי יש פנוי?\'. תענה אחרי. ועד אז — שניים הלכו למתחרה שענה מיד.",
            },
            {
              icon: "🔄",
              title: "הביטול שבא בהפתעה",
              body: "שעה לפני. \'לא מגיע\'. שעה ריקה. יש לקוחות שרצו אותה. לא ידעת. לא הספקת להגיד. כסף נשאר על הרצפה.",
            },
          ].map(item => (
            <div key={item.title} className="p-5 rounded-2xl"
              style={{ background: "#111", border: "1px solid rgba(255,255,255,0.06)" }}>
              <div className="text-2xl mb-2">{item.icon}</div>
              <h3 className="text-white font-semibold text-[15px] mb-2">{item.title}</h3>
              <p className="text-zinc-500 text-[13px] leading-relaxed">{item.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── SOLUTION BRIDGE ─────────────────────────────────────────── */}
      <section className="px-5 py-16 text-center relative overflow-hidden"
        style={{ background: "linear-gradient(180deg, #0D0D0D 0%, #091510 50%, #0D0D0D 100%)" }}>
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: "radial-gradient(ellipse at center, rgba(37,211,102,0.07) 0%, transparent 65%)" }} />
        <div className="relative max-w-sm mx-auto">
          <Label text="הפתרון" />
          <h2 className="text-3xl font-bold text-white mb-3">
            הכירו את המזכירה<br />
            <span style={{ color: WA }}>שלא מפספסת כלום.</span>
          </h2>
          <p className="text-zinc-400 text-[14px] leading-relaxed mb-8">
            בוט וואצאפ חכם שפועל מסביב לשעון — קובע, מזיז, מזכיר ומחזיר.
            <br /><span className="text-white">בלי שתעשה כלום.</span>
          </p>
          <div className="flex flex-wrap gap-2 justify-center">
            {["קביעת תורים 24/7", "הזזה אוטומטית", "תזכורות", "רשימת המתנה", "חזרת לקוחות", "ניהול הספר בוואצאפ"].map(f => (
              <span key={f} className="text-[12px] px-3 py-1.5 rounded-full font-semibold"
                style={{ background: "rgba(37,211,102,0.09)", color: WA, border: "1px solid rgba(37,211,102,0.2)" }}>
                {f}
              </span>
            ))}
          </div>
        </div>
      </section>

      <Hr />

      {/* ── FEATURES ────────────────────────────────────────────────── */}
      <section className="px-5 py-14">
        <div className="text-center mb-8">
          <Label text="מה הבוט עושה" />
          <h2 className="text-2xl font-bold text-white">הכל. בזמן שאתה עובד.</h2>
        </div>
        <div className="grid grid-cols-1 gap-4 max-w-md mx-auto">
          {[
            {
              icon: "🕐",
              title: "קביעת תורים 24/7",
              body: "לקוח שואל בחצות — הבוט עונה, מציג פנויים, קובע. אתה מתעורר עם יומן מלא.",
            },
            {
              icon: "🔄",
              title: "הזזה וביטולים חכמים",
              body: "תור מתבטל? הבוט מוציא את השעה לרשימת ההמתנה ומציע לפי סדר. השעה מתמלאת לבד.",
            },
            {
              icon: "💬",
              title: "מחזיר לקוחות אוטומטית",
              body: "חודש לא הגיע? שישה שבועות? הבוט שולח הודעה. 'חסרת לנו'. הוא קובע. אתה לא עשית כלום.",
            },
            {
              icon: "📲",
              title: "ניהול הספר בוואצאפ",
              body: "היומן, הביטולים, ההחלפות — הכל מנוהל מהוואצאפ שלך. בלי לפתוח אפליקציה אחרת.",
            },
          ].map(f => (
            <div key={f.title} className="p-5 rounded-2xl transition-colors"
              style={{ background: "#111", border: "1px solid rgba(255,255,255,0.06)" }}>
              <div className="text-2xl mb-3">{f.icon}</div>
              <h3 className="text-white font-semibold text-[15px] mb-2">{f.title}</h3>
              <p className="text-zinc-500 text-[13px] leading-relaxed">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <Hr />

      {/* ── AI FOMO ─────────────────────────────────────────────────── */}
      <section className="px-5 py-16 text-center relative overflow-hidden" style={{ background: "#080808" }}>
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: "radial-gradient(ellipse at center, rgba(212,175,55,0.07) 0%, transparent 65%)" }} />
        <div className="relative max-w-sm mx-auto">
          <Label text="AI · עכשיו · לא מחר" />
          <h2 className="font-bold text-white leading-tight mb-4"
            style={{ fontSize: "clamp(1.7rem, 7vw, 3rem)", fontFamily: "var(--font-display)" }}>
            AI לא עתיד.<br />
            <span style={{ color: GOLD }}>זה כבר עכשיו.</span>
          </h2>
          <p className="text-zinc-400 text-[14px] leading-relaxed mb-10">
            הספרים שמאמצים AI היום יהיו{" "}
            <span className="text-white font-semibold">המלאים של מחר.</span><br />
            אלה שיחכו — יחכו בחוץ.
          </p>

          {/* Stats */}
          <div className="space-y-3 text-right">
            {[
              { n: "+40%", label: "חזרת לקוחות עם תזכורות אוטומטיות" },
              { n: "3–4h", label: "שעות שנחסכות בשבוע על ניהול יומן" },
              { n: "0 שניות", label: "זמן מענה — הבוט עונה ללקוח מיידית" },
            ].map(s => (
              <div key={s.label} className="flex items-center gap-4 px-5 py-3.5 rounded-xl"
                style={{ background: "rgba(212,175,55,0.07)", border: "1px solid rgba(212,175,55,0.14)" }}>
                <span className="text-xl font-bold flex-shrink-0 text-center w-[72px]"
                  style={{ color: GOLD, fontFamily: "var(--font-display)" }}>{s.n}</span>
                <span className="text-zinc-300 text-[13px]">{s.label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <Hr />

      {/* ── HOW IT WORKS ────────────────────────────────────────────── */}
      <section className="px-5 py-14">
        <div className="text-center mb-8">
          <Label text="איך זה עובד" />
          <h2 className="text-2xl font-bold text-white">3 צעדים לשקט הנפשי</h2>
        </div>
        <div className="space-y-4 max-w-md mx-auto">
          {[
            { n: "1", t: "מספרים לנו על המספרה", b: "ספרים, שירותים, שעות עבודה. 15 דקות — והכל מוכן." },
            { n: "2", t: "הבוט מתחבר לוואצאפ שלך", b: "מהרגע הזה הוא עונה, קובע ומזכיר — בשמך." },
            { n: "3", t: "אתה מספר, הוא מנהל", b: "יומן מתמלא. לקוחות חוזרים. אתה עושה מה שאתה עושה הכי טוב." },
          ].map(step => (
            <div key={step.n} className="flex gap-4 items-start p-5 rounded-2xl"
              style={{ background: "#111", border: "1px solid rgba(255,255,255,0.06)" }}>
              <div className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0 text-black"
                style={{ background: GOLD }}>{step.n}</div>
              <div>
                <h3 className="text-white font-semibold text-[14px] mb-1">{step.t}</h3>
                <p className="text-zinc-500 text-[13px] leading-relaxed">{step.b}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <Hr />

      {/* ── CTA ─────────────────────────────────────────────────────── */}
      <section id="cta" className="px-5 py-16 text-center">
        <div className="max-w-sm mx-auto">
          <Label text="מתחילים" />
          <h2 className="text-2xl font-bold text-white mb-2">
            בוא נראה לך איך זה נראה<br />
            <span style={{ color: GOLD }}>על המספרה שלך</span>
          </h2>
          <p className="text-zinc-600 text-[13px] mb-8">
            15 דקות הדגמה · ללא התחייבות · ללא כרטיס אשראי
          </p>

          {!sent ? (
            <form onSubmit={handleSubmit} className="space-y-3">
              <input
                type="text"
                placeholder="שם (אופציונלי)"
                value={name}
                onChange={e => setName(e.target.value)}
                className="w-full rounded-2xl px-4 py-3.5 text-white text-[14px] placeholder-zinc-600 outline-none transition-colors"
                style={{ background: "#111", border: "1px solid rgba(255,255,255,0.08)" }}
                onFocus={e => (e.target.style.borderColor = "rgba(212,175,55,0.4)")}
                onBlur={e => (e.target.style.borderColor = "rgba(255,255,255,0.08)")}
              />
              <input
                type="tel"
                placeholder="מספר טלפון *"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                required
                className="w-full rounded-2xl px-4 py-3.5 text-white text-[14px] placeholder-zinc-600 outline-none transition-colors"
                style={{ background: "#111", border: "1px solid rgba(255,255,255,0.08)" }}
                onFocus={e => (e.target.style.borderColor = "rgba(212,175,55,0.4)")}
                onBlur={e => (e.target.style.borderColor = "rgba(255,255,255,0.08)")}
              />
              <button
                type="submit"
                className="w-full font-bold text-[14px] py-4 rounded-2xl text-black transition-transform hover:scale-[1.02] active:scale-[0.98]"
                style={{ background: GOLD }}>
                שלחו לי פרטים →
              </button>
              <p className="text-zinc-700 text-[11px]">נחזור אליך תוך שעות ספורות</p>

              {/* Alt: direct WhatsApp */}
              <div className="pt-2">
                <p className="text-zinc-700 text-[11px] mb-2">או</p>
                <a href="https://wa.me/972501234567?text=שלום, אני מעוניין לשמוע על המערכת"
                  target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-[13px] font-semibold px-5 py-2.5 rounded-full transition-opacity hover:opacity-85"
                  style={{ background: "rgba(37,211,102,0.12)", color: WA, border: "1px solid rgba(37,211,102,0.25)" }}>
                  <span>שלח לנו וואצאפ ישירות</span>
                  <span>💬</span>
                </a>
              </div>
            </form>
          ) : (
            <div className="p-8 rounded-2xl text-center"
              style={{ background: "rgba(37,211,102,0.06)", border: "1px solid rgba(37,211,102,0.2)" }}>
              <div className="text-4xl mb-3">✅</div>
              <p className="text-white font-semibold text-[15px] mb-1">קיבלנו!</p>
              <p className="text-zinc-400 text-[13px]">ניצור איתך קשר בקרוב להדגמה.</p>
            </div>
          )}
        </div>
      </section>

      {/* ── FOOTER ──────────────────────────────────────────────────── */}
      <div className="py-8 text-center" style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
        <p className="text-zinc-700 text-[11px] tracking-[0.2em] uppercase">
          DOMINANT System © {new Date().getFullYear()}
        </p>
        <p className="text-zinc-800 text-[10px] mt-1">מערכת ניהול מספרות מבוססת AI</p>
      </div>
    </div>
  );
}
