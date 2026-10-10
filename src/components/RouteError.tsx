"use client";

// Friendly Hebrew fallback instead of Next's white "Application error" screen.
// Most crashes on the booking flow are a deploy landing mid-booking (the page
// asks for a chunk of the previous build): one automatic reload fixes that, and
// every detail of the booking is in the URL, so nothing is lost. The crash is
// reported first so we can see what actually broke.
import { useEffect, useState } from "react";
import { reportClientError, reloadOnce } from "@/lib/client-error";

export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset?: () => void }) {
  const [reloading, setReloading] = useState(true);
  useEffect(() => {
    reportClientError(error, { digest: error?.digest, reloaded: true });
    if (!reloadOnce()) setReloading(false);
  }, [error]);

  return (
    <div dir="rtl" style={{ minHeight: "100svh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, background: "#F3EFE9", color: "#0A1633", fontFamily: "var(--font-heebo), system-ui, sans-serif" }}>
      <div style={{ maxWidth: 360, textAlign: "center" }}>
        <p style={{ fontSize: 22, fontWeight: 800, marginBottom: 10 }}>{reloading ? "רגע, טוען מחדש…" : "משהו השתבש בטעינה."}</p>
        {!reloading && (
          <>
            <p style={{ fontSize: 15, color: "#5b6176", lineHeight: 1.6, marginBottom: 22 }}>הפרטים שבחרת שמורים. לחץ כדי לנסות שוב.</p>
            <button onClick={() => (reset ? reset() : location.reload())}
              style={{ background: "#A6775B", color: "#fff", fontWeight: 800, fontSize: 17, border: 0, borderRadius: 100, padding: "14px 32px" }}>
              לנסות שוב
            </button>
          </>
        )}
      </div>
    </div>
  );
}
