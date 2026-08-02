"use client";

import { useEffect, useRef, useState } from "react";

const GOLD = "#D4AF37";
const WA = "#25D366";

// ─── Live agent demo (real chat, real agent — see src/app/api/demo-chat) ──────

type Bubble = { side: "right" | "left"; text: string };

const OPENING_HINT: Bubble = {
  side: "left",
  text: "עכשיו התור שלך — נסה לכתוב כאילו אתה לקוח, למשל \"אפשר לקבוע תור?\"",
};

// Ambient preview that autoplays on load and loops through a few different
// examples, so the widget shows activity at a glance instead of sitting
// empty (or freezing after one playthrough) until someone types. Purely
// visual (not a real agent call) — cut short the moment the visitor starts
// typing for real.
const AUTOPLAY_SCRIPTS: Bubble[][] = [
  [
    { side: "right", text: "היי, אפשר לקבוע תור?" },
    { side: "left", text: "היי! בטח 😊 לאיזה יום נוח לך?" },
    { side: "right", text: "מחר בבוקר אם יש" },
    { side: "left", text: "יש לי 9:30 ו-11:00 פנויים מחר. מה מתאים?" },
    { side: "right", text: "11 מעולה" },
    { side: "left", text: "סגור! תספורת מחר ב-11:00. שולח תזכורת יום לפני 🔔" },
  ],
  [
    { side: "right", text: "אני צריך להזיז את התור שלי ממחר" },
    { side: "left", text: "בטח, לאיזה יום או שעה תרצה להעביר?" },
    { side: "right", text: "אפשר ליום חמישי בערב?" },
    { side: "left", text: "יש לי חמישי 18:30, מתאים?" },
    { side: "right", text: "מעולה, תודה" },
    { side: "left", text: "הוזז! ביום חמישי 18:30 🙌" },
  ],
  [
    { side: "right", text: "כמה עולה תספורת + זקן?" },
    { side: "left", text: "תספורת + זקן זה 110 ₪, כ-45 דקות" },
    { side: "right", text: "מעולה, אפשר לקבוע גם לאבא שלי איתי באותה שעה?" },
    { side: "left", text: "בדקתי — יש שני ספרים פנויים במקביל ביום ראשון 16:00, אחד לכל אחד" },
    { side: "right", text: "מושלם, שנינו ב-16:00" },
    { side: "left", text: "קבעתי לשניכם ביום ראשון 16:00 ✌️" },
  ],
];

// "המספרה של דני" — the same demo business the widget used to talk to live.
// The on-site input no longer calls the real agent (cost + abuse surface) —
// it hands the visitor's typed text straight to a real WhatsApp chat instead.
const DEMO_WA_NUMBER = "972555081866";
const REDIRECT_HINT: Bubble = {
  side: "left",
  text: "בוא נמשיך בוואטסאפ — פותח לך שיחה עם ההודעה שלך 👇",
};

function openDemoWhatsApp(text: string) {
  const link = `https://wa.me/${DEMO_WA_NUMBER}?text=${encodeURIComponent(text)}`;
  window.open(link, "_blank", "noopener,noreferrer");
}

function WaPhone() {
  const [phase, setPhase] = useState<"autoplay" | "live">("autoplay");
  const [scriptIndex, setScriptIndex] = useState(0);
  const [autoplayShown, setAutoplayShown] = useState(0);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [input, setInput] = useState("");
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Play the ambient preview on loop (a different example each round) until
  // the visitor starts typing for real — see `send()`.
  useEffect(() => {
    if (phase !== "autoplay") return;
    const script = AUTOPLAY_SCRIPTS[scriptIndex % AUTOPLAY_SCRIPTS.length];
    if (autoplayShown >= script.length) {
      const t = setTimeout(() => {
        setBubbles([]);
        setAutoplayShown(0);
        setScriptIndex(i => i + 1);
      }, 2200);
      return () => clearTimeout(t);
    }
    const delay = autoplayShown === 0 ? 500 : 1100;
    const t = setTimeout(() => {
      setBubbles(b => [...b, script[autoplayShown]]);
      setAutoplayShown(s => s + 1);
    }, delay);
    return () => clearTimeout(t);
  }, [phase, scriptIndex, autoplayShown]);

  // Scroll only the chat container itself — never scrollIntoView() on
  // bottomRef, which can drag the WHOLE PAGE's scroll position to try to keep
  // this tiny ref in view (real incident: the autoplay loop kept yanking
  // visitors down the landing page away from the hero fold).
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [bubbles]);

  function send() {
    const text = input.trim();
    if (!text) return;
    const wasAutoplay = phase !== "live";
    if (wasAutoplay) setPhase("live");
    setInput("");
    setBubbles(b => [...(wasAutoplay ? [OPENING_HINT] : b), { side: "right", text }, REDIRECT_HINT]);
    openDemoWhatsApp(text);
  }

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
            <p className="text-white text-[13px] font-semibold leading-tight">מספרת דמו</p>
            <p className="text-[11px] mt-0.5" style={{ color: "#a7f3c3" }}>פעיל עכשיו • נסה בעצמך</p>
          </div>
        </div>

        {/* Chat bubbles */}
        <div ref={scrollContainerRef} className="p-3 space-y-2.5 h-[290px] overflow-y-auto flex flex-col"
          style={{ background: "linear-gradient(180deg, #0B1519 0%, #0d1b20 100%)" }} dir="ltr">
          {bubbles.map((m, i) => (
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
        </div>

        {/* Input bar */}
        <form
          className="flex items-center gap-2 px-3 py-2.5" style={{ background: "#1F2C34" }}
          onSubmit={e => { e.preventDefault(); send(); }}
        >
          <input
            className="flex-1 rounded-full h-8 px-3 text-[11px] text-white bg-transparent outline-none"
            style={{ background: "rgba(255,255,255,0.06)" }}
            placeholder="הודעה..."
            value={input}
            maxLength={500}
            onChange={e => setInput(e.target.value)}
            dir="rtl"
          />
          <button type="submit" disabled={!input.trim()}
            className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs disabled:opacity-40"
            style={{ background: WA }}>→</button>
        </form>
      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DEMO_WA_TEXT = encodeURIComponent("היי, ראיתי את הדמו באתר ורוצה לנסות לקבוע תור 😊");
const DEMO_WA_LINK = `https://wa.me/${DEMO_WA_NUMBER}?text=${DEMO_WA_TEXT}`;

function DemoWhatsAppCTA({ subtitle }: { subtitle?: string }) {
  return (
    <div className="text-center">
      {subtitle && <p className="text-zinc-300 text-[13px] mb-3">{subtitle}</p>}
      <a href={DEMO_WA_LINK} target="_blank" rel="noopener noreferrer"
        className="inline-flex items-center gap-2 text-[13px] font-bold px-6 py-3 rounded-full transition-transform hover:scale-105 active:scale-95"
        style={{ background: WA, color: "#04160c" }}>
        <span>💬</span>
        <span>נסה את הסוכן בוואטסאפ — על מספרה אמיתית</span>
      </a>
    </div>
  );
}

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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!phone) return;
    // Capture the lead in our own system so nothing is lost — the platform
    // owner gets a WhatsApp alert and the lead shows up in /admin/super.
    try {
      await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, phone }),
      });
    } catch {
      /* best-effort — still show success so the visitor isn't blocked */
    }
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
        <div className="flex items-center gap-3">
          <a href="/signup"
            className="text-[12px] font-bold text-zinc-300 hover:text-white transition-colors">
            פתחו עסק
          </a>
          <a href="#cta"
            className="text-[12px] font-bold px-4 py-2 rounded-full text-black transition-opacity hover:opacity-85"
            style={{ background: GOLD }}>
            קבע הדגמה
          </a>
        </div>
      </nav>

      {/* ── HERO ────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden px-5 pt-14 pb-12 flex flex-col items-center text-center gap-8">
        {/* bg glow */}
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: "radial-gradient(ellipse at 50% 0%, rgba(212,175,55,0.10) 0%, transparent 55%)" }} />

        <div className="relative max-w-sm">
          <Label text="AI · מערכת לספרים · וואצאפ" />
          <h1 className="font-bold leading-[1.08] text-white mb-3"
            style={{ fontSize: "clamp(2.2rem, 9vw, 4rem)", fontFamily: "var(--font-display)" }}>
            אתה מפספס לקוחות<br />
            <span style={{ color: GOLD }}>בלי לדעת.</span>
          </h1>
          <p className="text-zinc-400 text-[15px] leading-relaxed mb-6">
            כל הודעה שלא נענית בזמן, כל תור שמתבטל בלי שממלאים אותו — זה כסף שיצא מהיומן שלך. מהיום מישהו אחר עונה על הכל, מסביב לשעון:{" "}
            <span className="text-white font-semibold">קובע, מזכיר וממלא ביטולים — ואתה חוזר לעבודה.</span>
          </p>
          <p className="text-zinc-700 text-xs mt-3">לספר עצמאי או למספרה עם צוות · ללא התחייבות</p>
        </div>

        <WaPhone />
        <DemoWhatsAppCTA subtitle="מעדיף ישר להתנסות בוואטסאפ?" />
      </section>

      <Hr />

      {/* ── PAIN STORIES ────────────────────────────────────────────── */}
      <section className="px-5 py-14">
        <div className="text-center mb-10">
          <Label text="מצבים שכל ספר מכיר" />
          <h2 className="text-2xl font-bold text-white">
            אני בטוח שיצא לך להכיר —<br />
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
              body: "שעה לפני. \'לא מגיע\'. שעה ריקה באמצע היום. מישהו היה ממלא אותה בשמחה — אם רק היה יודע שהתפנתה.",
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

      <Hr />

      {/* ── PAIN NUMBERS ────────────────────────────────────────────── */}
      <section className="px-5 py-14">
        <div className="text-center mb-8">
          <h2 className="text-2xl font-bold text-white">כמה לקוחות אתה מפספס?</h2>
        </div>
        <div className="grid grid-cols-1 gap-4 max-w-md mx-auto">
          {[
            {
              stat: "50%",
              label: "מהלקוחות שהגיעו בפעם הראשונה לא חוזרים",
              detail: "הגיעו פעם אחת. היו מרוצים. נעלמו. לא כי מצאו מישהו אחר — כי אף אחד לא הזכיר להם לחזור.",
            },
            {
              stat: "47",
              label: "הודעות וואצאפ בשבוע שלא נענות",
              detail: "אמצע תספורת. מרטט. 'מתי יש פנוי?'. 'כמה עולה?'. תענה אחרי. ועד אז — הם הלכו למתחרה שענה. כמה לקוחות חדשים שפונים אליך ככה אתה מפספס בלי לדעת?",
            },
            {
              stat: "₪300+",
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
              <span className="text-zinc-400 text-[12px] leading-relaxed">{item.detail}</span>
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
          <h2 className="text-3xl font-bold text-white mb-3">
            תכירו את המזכירה<br />
            <span style={{ color: WA }}>שלא מפספסת כלום.</span>
          </h2>
          <p className="text-zinc-400 text-[14px] leading-relaxed mb-8">
            מערכת חכמה שיושבת על הוואצאפ של המספרה — לא על הוואצאפ שלך — ועובדת מסביב לשעון: קובעת, מזכירה, ממלאת ביטולים ומחזירה לקוחות.
            <br /><span className="text-white">בלי שתזיז אצבע.</span>
          </p>
          <div className="flex flex-wrap gap-2 justify-center">
            {["קביעת תורים 24/7", "הזזה אוטומטית", "תזכורות", "רשימת המתנה", "חזרת לקוחות", "יומן לכל הספרים"].map(f => (
              <span key={f} className="text-[12px] px-3 py-1.5 rounded-full font-semibold"
                style={{ background: "rgba(37,211,102,0.09)", color: WA, border: "1px solid rgba(37,211,102,0.2)" }}>
                {f}
              </span>
            ))}
          </div>
          <div className="mt-8">
            <DemoWhatsAppCTA subtitle="לא מאמין שזה עובד ככה? תבדוק בעצמך" />
          </div>
        </div>
      </section>

      <Hr />

      {/* ── FEATURES ────────────────────────────────────────────────── */}
      <section className="px-5 py-14">
        <div className="text-center mb-8">
          <Label text="מה הסוכן עושה" />
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
              title: "צוות שלם, יומן אחד",
              body: "ספר אחד או עשרה — היומן של כל הספרים, הביטולים וההחלפות מנוהלים ממקום אחד. בלי בלגן.",
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
              { n: "3H-4H", label: "שעות שנחסכות בשבוע על ניהול יומן" },
              { n: "0 שניות", label: "זמן מענה — הסוכן עונה ללקוח מיידית" },
            ].map(s => (
              <div key={s.label} className="flex items-center gap-4 px-5 py-3.5 rounded-xl"
                style={{ background: "rgba(212,175,55,0.07)", border: "1px solid rgba(212,175,55,0.14)" }}>
                <span className="text-xl font-bold flex-shrink-0 text-center w-[72px]"
                  style={{ color: GOLD, fontFamily: "var(--font-display)" }}>{s.n}</span>
                <span className="text-zinc-300 text-[13px]">{s.label}</span>
              </div>
            ))}
          </div>

          <div className="mt-6 p-6 rounded-2xl text-right"
            style={{ background: "rgba(37,211,102,0.08)", border: "1px solid rgba(37,211,102,0.22)" }}>
            <p className="text-white font-bold text-[16px] leading-relaxed mb-2">
              כל מי שרק שואל <span style={{ color: WA }}>"כמה עולה?"</span> —
              הסוכן סוגר אותו לתור ב-80-90% מהמקרים.
            </p>
            <p className="text-zinc-300 text-[13px] leading-relaxed">
              לא ענה מיד? הוא לא מוותר — שולח פולואפ ותזכורות עד שסוגרים תור ביומן.{" "}
              <span className="text-white font-semibold">זו לא רק מזכירה — זה איש מכירות שיושב לך בוואצאפ.</span>
            </p>
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

      {/* ── VALUE / ROI ─────────────────────────────────────────────── */}
      <section className="px-5 py-16 relative overflow-hidden" style={{ background: "#080808" }}>
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: "radial-gradient(ellipse at center, rgba(212,175,55,0.06) 0%, transparent 65%)" }} />
        <div className="relative max-w-md mx-auto">
          <div className="text-center mb-8">
            <Label text="כמה זה שווה לך" />
            <h2 className="text-2xl font-bold text-white">
              תעשה את החשבון.<br />
              <span style={{ color: GOLD }}>הוא פשוט.</span>
            </h2>
          </div>

          <div className="space-y-3">
            {[
              {
                head: "לקוח אחד שחוזר",
                money: "₪1,920 בשנה",
                body: "תספורת כל שבועיים, שנה שלמה. הסוכן מחזיר לך לא לקוח אחד — הוא מחזיר לך עשרות לקוחות.",
              },
              {
                head: "שעה ריקה שמתמלאת",
                money: "₪1,600 בחודש",
                body: "שעה אחת בשבוע שהייתה הולכת לאיבוד. רשימת ההמתנה ממלאת אותה לבד.",
              },
              {
                head: "הזמן שחוזר אליך",
                money: "3–4 שעות בשבוע",
                body: "כל הניהול בוואצאפ — תיאומים, אישורים, הזזות. זמן לעוד לקוחות, או לעצמך.",
              },
              {
                head: "יותר גרוע מהזמן",
                money: "",
                body: "אני יודע שכאב הראש והאנרגיה שניהול וואצאפ גוזל ממך — הרבה יותר גרוע מהזמן שזה לוקח. בדיוק בגלל זה יצרנו את הסוכן.",
              },
            ].map(row => (
              <div key={row.head} className="flex items-start gap-4 px-5 py-4 rounded-2xl"
                style={{ background: "#111", border: "1px solid rgba(212,175,55,0.14)" }}>
                <div className="flex-1">
                  <h3 className="text-white font-semibold text-[14px] mb-1">{row.head}</h3>
                  <p className="text-zinc-500 text-[12px] leading-relaxed">{row.body}</p>
                </div>
                {row.money && (
                  <span className="text-[13px] font-bold whitespace-nowrap" style={{ color: GOLD, fontFamily: "var(--font-display)" }}>
                    {row.money}
                  </span>
                )}
              </div>
            ))}
          </div>

          <p className="text-center text-zinc-400 text-[14px] leading-relaxed mt-8">
            כל אחד מהארבעה מחזיר יותר ממה שהמערכת עולה.<br />
            <span className="text-white font-semibold">ואתה מקבל את כולם יחד.</span>
          </p>
        </div>
      </section>

      <Hr />

      {/* ── CTA ─────────────────────────────────────────────────────── */}
      <section id="cta" className="px-5 py-16 text-center">
        <div className="max-w-sm mx-auto">
          <Label text="מתחילים" />
          <h2 className="text-2xl font-bold text-white mb-2">
            רגע לפני —<br />
            <span style={{ color: GOLD }}>אני מזמין אותך לנסות</span><br />
            את הסוכן בוואצאפ, על מספרה אמיתית
          </h2>
          <p className="text-zinc-600 text-[13px] mb-8">
            15 דקות הדגמה · ללא התחייבות · ללא כרטיס אשראי
          </p>

          <div className="mb-8">
            <DemoWhatsAppCTA subtitle="או פשוט תנסה קודם, בלי למלא כלום" />
          </div>

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
                אני רוצה שקט נפשי ויומן מלא →
              </button>
              <p className="text-zinc-700 text-[11px]">נחזור אליך תוך שעות ספורות</p>

              {/* Alt: direct WhatsApp */}
              <div className="pt-2">
                <p className="text-zinc-700 text-[11px] mb-2">או</p>
                <a href="https://wa.me/972585859990?text=שלום, אני מעוניין לשמוע על המערכת"
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
