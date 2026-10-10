"use client";

import { useEffect, useState } from "react";
import { C, Btn, crmAction } from "./ui";

/**
 * The CRM's own push notifications (10.10.2026, Yair: "התראות רק על ה-CRM",
 * "שלא יהיה הרבה הודעות"). Subscribes THIS app (the CRM's home-screen
 * shortcut) to the CRM's few pushes; the barbershop app keeps its own.
 */

function key(b64: string): Uint8Array {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}
const standalone = () =>
  (typeof window !== "undefined" && window.matchMedia?.("(display-mode: standalone)").matches) ||
  (typeof navigator !== "undefined" && (navigator as unknown as { standalone?: boolean }).standalone === true);

type State = "loading" | "unsupported" | "needs-install" | "denied" | "off" | "on" | "busy";

export const PUSH_EVENTS = [
  "ליד חדש",
  "ליד שמבקש לדבר עם בן אדם",
  "10 דקות לפני שיחה",
  "הוואטסאפ של לקוח התנתק",
  "נגמרה החבילה של לקוח (הסוכן שלו הפסיק לענות)",
  "לקוח של צ'אטור כתב למספר של צ'אטור",
  "תקלה במערכת",
];

export function useCrmPush() {
  const [state, setState] = useState<State>("loading");
  const [endpoint, setEndpoint] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      if (!("serviceWorker" in navigator && "PushManager" in window && "Notification" in window)) { setState("unsupported"); return; }
      if (/iphone|ipad|ipod/i.test(navigator.userAgent) && !standalone()) { setState("needs-install"); return; }
      if (Notification.permission === "denied") { setState("denied"); return; }
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        const sub = reg && (await reg.pushManager.getSubscription());
        if (sub && Notification.permission === "granted") {
          setEndpoint(sub.endpoint);
          const r = await crmAction({ action: "push.status", endpoint: sub.endpoint });
          setState(r.registered ? "on" : "off");
          return;
        }
      } catch { /* fall through */ }
      setState("off");
    })();
  }, []);

  async function enable(): Promise<string | null> {
    setState("busy");
    try {
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const perm = await Notification.requestPermission();
      if (perm !== "granted") { setState(perm === "denied" ? "denied" : "off"); return "לא אושרו התראות"; }
      const { publicKey } = await fetch("/api/admin/native/web-push").then(r => r.json());
      const sub = (await reg.pushManager.getSubscription()) ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key(publicKey) as BufferSource });
      const r = await crmAction({ action: "push.subscribe", subscription: sub.toJSON() });
      if (!r.ok) { setState("off"); return r.error ?? "השמירה נכשלה"; }
      setEndpoint(sub.endpoint);
      setState("on");
      return null;
    } catch (e) {
      setState("off");
      return e instanceof Error ? e.message : "שגיאה";
    }
  }
  async function disable() {
    if (!endpoint) return;
    setState("busy");
    await crmAction({ action: "push.unsubscribe", endpoint });
    setState("off");
  }
  return { state, enable, disable };
}

/** Home: a slim strip only while this phone does not get the CRM's pushes yet. */
export function CrmPushBanner() {
  const { state, enable } = useCrmPush();
  const [err, setErr] = useState<string | null>(null);
  if (state !== "off" && state !== "busy" && state !== "needs-install") return null;
  return (
    <section className="rounded-2xl ps-4 pe-2 py-2 flex flex-wrap items-center justify-between gap-2 text-sm" style={{ background: C.mist, color: C.petrol }}>
      {state === "needs-install"
        ? <span>להתראות לטלפון: שיתוף ← &quot;הוסף למסך הבית&quot;, ופתח את ה-CRM מהאייקון.</span>
        : <span>התראות לטלפון, רק על מה שחשוב.{err ? ` ${err}` : ""}</span>}
      {state !== "needs-install" && <Btn kind="dark" className="!min-h-[38px] !px-3 !text-[13px]" disabled={state === "busy"} onClick={async () => setErr(await enable())}>{state === "busy" ? "מפעיל…" : "הפעל"}</Btn>}
    </section>
  );
}

/** Settings: status, what pushes, test, off on this phone. */
export function CrmPushSettings({ devices }: { devices: number }) {
  const { state, enable, disable } = useCrmPush();
  const [note, setNote] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 text-sm" style={{ color: C.muted }}>
        {state === "on" ? "✓ הטלפון הזה מקבל את ההתראות של ה-CRM." : state === "denied" ? "ההתראות חסומות בטלפון: הגדרות ← התראות ← CRM." : state === "needs-install" ? "באייפון: שיתוף ← \"הוסף למסך הבית\", פתח את ה-CRM מהאייקון והפעל מכאן." : state === "unsupported" ? "הדפדפן הזה לא תומך בהתראות." : "הטלפון הזה עוד לא מקבל התראות."}
        {devices > 0 ? ` (${devices} מכשירים פעילים)` : ""}
      </p>
      <div>
        <p className="m-0 mb-1 text-sm font-semibold">מה מגיע כהתראה (וכל השאר רק ברשימת ההתראות):</p>
        <ul className="m-0 ps-5 text-sm leading-relaxed" style={{ color: C.muted }}>{PUSH_EVENTS.map(e => <li key={e}>{e}</li>)}</ul>
      </div>
      <div className="flex flex-wrap gap-2">
        {(state === "off" || state === "busy") && <Btn kind="dark" disabled={state === "busy"} onClick={async () => setNote(await enable())}>הפעל התראות בטלפון הזה</Btn>}
        {state === "on" && <Btn kind="outline" onClick={async () => { const r = await crmAction({ action: "push.test" }); setNote(r.ok ? "נשלחה התראת בדיקה" : r.error ?? "לא נשלחה"); }}>שלח התראת בדיקה</Btn>}
        {state === "on" && <Btn kind="ghost" onClick={() => void disable()}>כבה בטלפון הזה</Btn>}
      </div>
      {note && <p className="m-0 text-[13px]" style={{ color: C.petrol }}>{note}</p>}
      <p className="m-0 text-xs" style={{ color: C.muted }}>כל עוד אף טלפון לא מקבל את ההתראות, הדברים החשובים ממשיכים להגיע אליך בוואטסאפ. אחרי שתפעיל, וואטסאפ רק על תקלה במערכת.</p>
    </div>
  );
}
