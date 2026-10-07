"use client";

// Design preview (owner, 7.10.2026): the customer home in the visual language
// of the new barbershop site (dominant-site): deep multi-tone navy, brown
// kicker over a bold headline that ends with a dot, rounded 4:5 cards, team in
// black-and-white that turns to colour, rise / reveal / parallax motion.
// Same content and data as the live home page — this route only exists so the
// owner can compare; customers keep seeing "/".
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSlug, apiWithSlug, publicHref } from "@/lib/public-nav";

type Story = { id: string; mediaUrl: string; caption: string | null; staff?: { id: string; name: string; avatarUrl: string | null } | null };
type QuickSlot = { staffId: string; staffName: string; date: string; dayLabel: string; time: string; serviceId: string };
type Staff = { id: string; name: string; avatarUrl: string | null };
type Announcement = { id: string; title: string; content: string | null };
type Product = { id: string; name: string; description: string | null; price: number; imageUrl: string | null };
type Biz = { name: string; address: string | null; phone: string | null; about: string | null; coverImageUrl: string | null; socialLinks?: { waze?: string; instagram?: string; whatsapp?: string } };

const CSS = `
.lk{--navy:#0A1633;--brown:#A6775B;--cream:#F3EFE9;--muted:#98a0b4;--line:rgba(243,239,233,.12);--card:#0f1b3a;
  min-height:100svh;color:var(--cream);font-family:var(--font-heebo),Heebo,system-ui,sans-serif;overflow-x:clip;-webkit-font-smoothing:antialiased;
  background:radial-gradient(ellipse 90% 45% at 85% 30%,rgba(26,42,82,.55),transparent 70%),radial-gradient(ellipse 80% 40% at 10% 58%,rgba(18,30,62,.6),transparent 70%),
  radial-gradient(ellipse 70% 30% at 70% 88%,rgba(46,34,30,.35),transparent 70%),linear-gradient(180deg,#070f22 0%,#040914 22%,#0a1430 45%,#03060f 68%,#071024 86%,#02040a 100%)}
.lk a{color:inherit;text-decoration:none}
.lk .kicker{font-weight:700;font-size:14px;letter-spacing:.04em;color:var(--brown);margin-bottom:10px}
.lk h2{font-weight:900;font-size:clamp(34px,9vw,64px);line-height:1.02;letter-spacing:-.02em}
.lk .sub{color:var(--muted);font-size:15px;margin-top:10px}
.lk .pad{padding-inline:20px}
.lk .btn{display:inline-flex;align-items:center;gap:10px;background:var(--brown);color:#fff;font-weight:800;font-size:18px;padding:15px 30px;border-radius:100px;box-shadow:0 10px 26px rgba(166,119,91,.3);transition:transform .25s}
.lk .btn:active{transform:scale(.97)}
.lk .btn-sm{font-size:14px;padding:9px 18px;box-shadow:none}
.lk .bar{position:fixed;inset:0 0 auto;z-index:50;display:flex;justify-content:space-between;align-items:center;padding:12px 16px;transition:background .35s,border-color .35s;border-bottom:1px solid transparent}
.lk .bar.on{background:rgba(3,7,18,.8);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border-color:var(--line)}
.lk .bar-logo,.lk .bar .btn{opacity:0;transition:opacity .35s,transform .35s;transform:translateY(-6px);pointer-events:none}
.lk .bar.on .bar-logo,.lk .bar.on .btn{opacity:1;transform:none;pointer-events:auto}
.lk .bar-logo{display:flex;align-items:center;gap:8px;direction:ltr}
.lk .bar-logo img{height:28px;width:auto}.lk .bar-logo span{font-weight:800;font-size:14px;letter-spacing:.3em}
.lk .hero{position:relative;min-height:100svh;display:flex;flex-direction:column;overflow:hidden}
.lk .hero-bg{position:absolute;inset:0;background:radial-gradient(ellipse 55% 45% at 50% 38%,#17264a 0%,rgba(13,24,50,.9) 35%,transparent 75%),radial-gradient(ellipse 60% 50% at 80% 100%,rgba(40,30,28,.45),transparent 70%)}
.lk .hero-in{position:relative;flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:70px 20px 16px;will-change:transform,opacity}
.lk .pills{display:flex;gap:8px;justify-content:center;margin-bottom:26px}
.lk .pill{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600;padding:6px 14px;border-radius:100px;border:1px solid var(--line);background:rgba(243,239,233,.06)}
.lk .hero-logo{width:min(300px,70vw);margin:0 auto 26px}
.lk .hero-line{font-weight:900;font-size:clamp(30px,8.4vw,56px);line-height:1.08;letter-spacing:-.01em;margin-bottom:26px}
.lk .hero-line em{font-style:normal;color:var(--brown)}
.lk .rise{animation:lk-rise 1.1s cubic-bezier(.2,.7,.2,1) both}
.lk .d1{animation-delay:.12s}.lk .d2{animation-delay:.24s}.lk .d3{animation-delay:.36s}.lk .d4{animation-delay:.5s}
@keyframes lk-rise{from{opacity:0;transform:translateY(26px)}to{opacity:1;transform:none}}
.lk .slots-h{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:700;color:var(--muted);margin-bottom:10px;padding-inline:20px}
.lk .dot{width:8px;height:8px;border-radius:50%;background:#3fbf6f;box-shadow:0 0 0 4px rgba(63,191,111,.18)}
.lk .rail{display:flex;gap:10px;overflow-x:auto;scroll-snap-type:x mandatory;padding:0 20px 4px;scrollbar-width:none}
.lk .rail::-webkit-scrollbar{display:none}
.lk .slot{flex:none;scroll-snap-align:start;width:112px;padding:12px 12px 10px;border-radius:18px;border:1px solid var(--line);background:rgba(243,239,233,.05)}
.lk .slot b{display:block;font-size:22px;font-weight:800;letter-spacing:.02em;direction:ltr;text-align:right}
.lk .slot span{display:block;font-size:11px;color:var(--muted);margin-top:4px}
.lk .hint{position:relative;width:24px;height:40px;margin:22px auto 18px;border:2px solid var(--line);border-radius:14px}
.lk .hint span{position:absolute;top:7px;left:50%;width:4px;height:8px;margin-left:-2px;border-radius:2px;background:var(--brown);animation:lk-hint 1.8s infinite}
@keyframes lk-hint{0%{opacity:0;transform:translateY(0)}30%{opacity:1}100%{opacity:0;transform:translateY(14px)}}
.lk section.block{padding:84px 0 20px}
.lk .cuts{display:flex;gap:12px;overflow-x:auto;scroll-snap-type:x mandatory;padding:24px 20px 6px;scrollbar-width:none}
.lk .cuts::-webkit-scrollbar{display:none}
.lk .cut{flex:none;scroll-snap-align:start;width:min(68vw,300px);aspect-ratio:4/5;border-radius:22px;overflow:hidden;position:relative;background:var(--card);box-shadow:0 20px 50px rgba(0,0,0,.45)}
.lk .cut img{width:100%;height:100%;object-fit:cover}
.lk .cut .tag{position:absolute;bottom:12px;right:12px;font-size:12px;font-weight:700;padding:5px 12px;border-radius:100px;background:rgba(3,7,18,.6);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}
.lk .team{margin:40px 8px 0;padding:70px 12px 40px;border-radius:32px;background:var(--cream);color:var(--navy)}
.lk .team .sub{color:#6b7084}
.lk .grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin-top:28px}
.lk .member .ph{aspect-ratio:4/5;border-radius:20px;overflow:hidden;background:#e8e2d9}
.lk .member img{width:100%;height:100%;object-fit:cover;filter:grayscale(1) contrast(1.05);transition:filter .8s,transform .9s}
.lk .member.lit img{filter:none;transform:scale(1.03)}
.lk .member b{display:block;font-weight:800;font-size:17px;margin-top:10px}
.lk .member small{display:inline-block;margin-top:6px;font-size:12px;font-weight:700;color:var(--brown)}
.lk .cards{display:flex;flex-direction:column;gap:12px;margin-top:26px}
.lk .card{border-radius:20px;padding:18px 18px;border:1px solid var(--line);background:rgba(243,239,233,.04)}
.lk .card b{display:block;font-size:16px;font-weight:800;margin-bottom:6px}
.lk .card p{font-size:14px;line-height:1.6;color:var(--muted);white-space:pre-line}
.lk .prod{flex:none;scroll-snap-align:start;width:170px;border-radius:20px;overflow:hidden;border:1px solid var(--line);background:rgba(243,239,233,.04)}
.lk .prod .pi{aspect-ratio:1;background:#fff;display:flex;align-items:center;justify-content:center}
.lk .prod .pi img{max-width:80%;max-height:80%;object-fit:contain}
.lk .prod div.t{padding:12px}.lk .prod b{display:block;font-size:14px;font-weight:800}.lk .prod span{display:block;color:var(--brown);font-weight:800;margin-top:6px}
.lk .moment{position:relative;height:96svh;overflow:hidden;display:flex;align-items:flex-end;margin-top:84px}
.lk .moment img{position:absolute;inset:-12% 0;width:100%;height:124%;object-fit:cover;will-change:transform}
.lk .moment .shade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(5,10,25,.1) 30%,rgba(5,10,25,.85))}
.lk .moment .mt{position:relative;padding:0 20px 70px}
.lk .moment h2{font-size:clamp(32px,8.6vw,60px);margin-bottom:22px}
.lk .end{padding:90px 20px 120px;display:flex;flex-direction:column;align-items:center;text-align:center;gap:30px;background:radial-gradient(ellipse 60% 50% at 50% 15%,#111d3b,transparent 70%)}
.lk .end img{width:min(240px,60vw)}
.lk .info{display:flex;flex-direction:column;gap:10px;font-size:16px;line-height:1.5;color:var(--muted)}
.lk .info b{color:var(--cream);font-weight:800}
.lk .link{font-weight:700;color:var(--brown);border-bottom:2px solid currentColor;padding-bottom:2px}
.lk .rule{display:flex;align-items:center;gap:14px;width:min(360px,80vw);direction:ltr;color:var(--brown);font-size:12px;letter-spacing:.5em}
.lk .rule:before,.lk .rule:after{content:"";flex:1;height:2px;background:currentColor}
.lk .float{position:fixed;z-index:60;left:50%;bottom:max(16px,env(safe-area-inset-bottom));transform:translate(-50%,140%);transition:transform .45s cubic-bezier(.2,.7,.2,1);white-space:nowrap;box-shadow:0 12px 30px rgba(0,0,0,.35)}
.lk .float.on{transform:translate(-50%,0)}
.lk .reveal{opacity:0;transform:translateY(34px);transition:opacity 1s cubic-bezier(.2,.7,.2,1),transform 1s cubic-bezier(.2,.7,.2,1)}
.lk .reveal.in{opacity:1;transform:none}
.lk .cut.reveal{transform:translateY(24px) scale(.96)}
.lk .cut.reveal.in{transform:none}
@media (prefers-reduced-motion:reduce){.lk *,.lk *:before,.lk *:after{animation:none!important;transition:none!important}.lk .reveal{opacity:1;transform:none}}
`;

export default function LookPreview() {
  const slug = useSlug();
  const href = (p: string) => publicHref(slug, p);
  const [biz, setBiz] = useState<Biz | null>(null);
  const [slots, setSlots] = useState<QuickSlot[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [stories, setStories] = useState<Story[]>([]);
  const [ann, setAnn] = useState<Announcement[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [hello, setHello] = useState("");
  const [scrolled, setScrolled] = useState(false);
  const root = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const get = (u: string) => fetch(apiWithSlug(u, slug)).then(r => r.json()).catch(() => null);
    Promise.all([get("/api/business"), get("/api/quick-slots"), get("/api/staff"), get("/api/stories"), get("/api/announcements"), get("/api/products")])
      .then(([b, q, st, s, a, p]) => {
        setBiz(b); setSlots(Array.isArray(q) ? q : []); setStaff(Array.isArray(st) ? st : []);
        setStories(Array.isArray(s) ? s : []); setAnn(Array.isArray(a) ? a : []); setProducts(Array.isArray(p) ? p : []);
      });
    try { const c = JSON.parse(localStorage.getItem("bk_customer") || "null"); if (c?.name) setHello(String(c.name).split(" ")[0]); } catch { /* ignore */ }
  }, [slug]);

  // One photo per barber in turn, then the next round (same as the live gallery).
  const gallery = useMemo(() => {
    const rank = new Map(staff.map((m, i) => [m.id, i]));
    const groups = new Map<string, Story[]>();
    for (const s of stories) { const k = s.staff?.id ?? "_"; if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(s); }
    const lists = Array.from(groups.entries()).sort((a, b) => (rank.get(a[0]) ?? 999) - (rank.get(b[0]) ?? 999)).map(([, l]) => l);
    const out: Story[] = [];
    for (let i = 0; lists.some(l => i < l.length); i++) for (const l of lists) if (i < l.length) out.push(l[i]);
    return out;
  }, [stories, staff]);

  const nextFree = useMemo(() => {
    const m = new Map<string, QuickSlot>();
    for (const s of slots) if (!m.has(s.staffId)) m.set(s.staffId, s);
    return m;
  }, [slots]);

  // Bar + floating button + parallax.
  useEffect(() => {
    let raf = 0;
    const on = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const y = window.scrollY;
        setScrolled(y > window.innerHeight * 0.55);
        const el = root.current; if (!el) return;
        const heroIn = el.querySelector<HTMLElement>(".hero-in");
        if (heroIn) { const k = Math.min(y / 500, 1); heroIn.style.transform = `translateY(${y * 0.25}px) scale(${1 - k * 0.06})`; heroIn.style.opacity = String(1 - k * 0.9); }
        const m = el.querySelector<HTMLElement>(".moment");
        const mi = m?.querySelector<HTMLElement>("img");
        if (m && mi) { const r = m.getBoundingClientRect(); mi.style.transform = `translateY(${(r.top / window.innerHeight) * -60}px)`; }
      });
    };
    window.addEventListener("scroll", on, { passive: true });
    on();
    return () => { window.removeEventListener("scroll", on); if (raf) cancelAnimationFrame(raf); };
  }, []);

  // Reveal on scroll; team photos turn to colour as they come in.
  useEffect(() => {
    const el = root.current; if (!el) return;
    const io = new IntersectionObserver(es => {
      for (const e of es) {
        if (!e.isIntersecting) continue;
        e.target.classList.add(e.target.classList.contains("member") ? "lit" : "in");
        if (e.target.classList.contains("member")) e.target.classList.add("in");
        io.unobserve(e.target);
      }
    }, { threshold: 0.25, rootMargin: "0px 0px -8% 0px" });
    el.querySelectorAll(".reveal, .member").forEach(n => { if (!n.classList.contains("in")) io.observe(n); });
    return () => io.disconnect();
  }, [gallery.length, staff.length, ann.length, products.length, biz]);

  const name = biz?.name || "DOMINANT";

  return (
    <div className="lk" dir="rtl" ref={root}>
      <style>{CSS}</style>

      <header className={`bar ${scrolled ? "on" : ""}`}>
        <a className="bar-logo" href="#top"><img src="/look/icon-white.png" alt="" /><span>{name.toUpperCase()}</span></a>
        <Link className="btn btn-sm" href={href("/book")}>קבע תור</Link>
      </header>

      <section className="hero" id="top">
        <div className="hero-bg" />
        <div className="hero-in">
          <div className="pills rise">
            {hello && <span className="pill">👋 היי {hello}</span>}
            <Link className="pill" href={href("/book/my-appointments")}>📅 התורים שלי</Link>
          </div>
          <img className="hero-logo rise d1" src="/look/logo-white.png" alt={name} />
          <h1 className="hero-line rise d2">הרושם הראשוני<br /><em>מתחיל בשיער.</em></h1>
          <div className="rise d3"><Link className="btn" href={href("/book")}>קבע תור עכשיו <span aria-hidden>←</span></Link></div>
        </div>
        {slots.length > 0 && (
          <div className="rise d4" style={{ position: "relative" }}>
            <div className="slots-h"><span className="dot" />התורים הקרובים</div>
            <div className="rail">
              {slots.slice(0, 8).map(s => (
                <Link key={`${s.staffId}${s.date}${s.time}`} className="slot"
                  href={href(`/book/confirm?staffId=${s.staffId}&serviceId=${s.serviceId}&date=${s.date}&time=${s.time}&from=home`)}>
                  <b>{s.time}</b><span>{s.dayLabel} · {s.staffName.trim().split(" ")[0]}</span>
                </Link>
              ))}
            </div>
          </div>
        )}
        <div className="hint" aria-hidden><span /></div>
      </section>

      {gallery.length > 0 && (
        <section className="block">
          <div className="pad reveal"><div className="kicker">העבודה</div><h2>כל תספורת,<br />בדיוק.</h2></div>
          <div className="cuts">
            {gallery.map(s => (
              <div key={s.id} className="cut reveal">
                <img src={s.mediaUrl} alt="" loading="lazy" />
                {s.staff?.name && <span className="tag">{s.staff.name.trim()}</span>}
              </div>
            ))}
          </div>
        </section>
      )}

      {staff.length > 0 && (
        <section className="team">
          <div className="reveal"><div className="kicker">הצוות</div><h2 style={{ color: "#0A1633" }}>{staff.length} ספרים.</h2><p className="sub">לחץ על ספר כדי לקבוע אצלו.</p></div>
          <div className="grid">
            {staff.map(m => {
              const f = nextFree.get(m.id);
              return (
                <Link key={m.id} className="member reveal" href={href(`/book/service?staffId=${m.id}`)}>
                  <div className="ph">{m.avatarUrl && <img src={m.avatarUrl} alt={m.name} loading="lazy" />}</div>
                  <b>{m.name.trim()}</b>
                  {f && <small>הקרוב: {f.dayLabel} {f.time}</small>}
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {ann.length > 0 && (
        <section className="block"><div className="pad">
          <div className="reveal"><div className="kicker">עדכונים</div><h2>מה חדש.</h2></div>
          <div className="cards">
            {ann.map(a => <div key={a.id} className="card reveal"><b>{a.title}</b>{a.content && <p>{a.content}</p>}</div>)}
          </div>
        </div></section>
      )}

      {products.length > 0 && (
        <section className="block">
          <div className="pad reveal"><div className="kicker">המוצרים</div><h2>לקחת הביתה.</h2></div>
          <div className="cuts">
            {products.map(p => (
              <div key={p.id} className="prod reveal">
                <div className="pi">{p.imageUrl && <img src={p.imageUrl} alt="" loading="lazy" />}</div>
                <div className="t"><b>{p.name}</b><span>₪{p.price}</span></div>
              </div>
            ))}
          </div>
        </section>
      )}

      {biz?.coverImageUrl && (
        <section className="moment">
          <img src={biz.coverImageUrl} alt="" />
          <div className="shade" />
          <div className="mt reveal">
            <h2>לחץ כאן,<br />אנחנו מחכים לך במספרה.</h2>
            <Link className="btn" href={href("/book")}>קבע תור עכשיו <span aria-hidden>←</span></Link>
          </div>
        </section>
      )}

      <section className="end">
        <img className="reveal" src="/look/logo-white.png" alt={name} />
        <div className="info reveal">
          {biz?.address && <span><b>{biz.address}</b></span>}
          {biz?.phone && <a className="link" href={`https://wa.me/${biz.phone.replace(/\D/g, "").replace(/^0/, "972")}`} target="_blank" rel="noopener">וואטסאפ {biz.phone}</a>}
          {biz?.socialLinks?.waze && <a className="link" href={biz.socialLinks.waze} target="_blank" rel="noopener">ניווט בוויז</a>}
        </div>
        <div className="rule"><span>BARBERSHOP</span></div>
      </section>

      <Link className={`btn float ${scrolled ? "on" : ""}`} href={href("/book")}>קבע תור עכשיו <span aria-hidden>←</span></Link>
    </div>
  );
}
