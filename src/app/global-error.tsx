"use client";

// A crash in the root layout itself — must render its own <html>/<body>.
import RouteError from "@/components/RouteError";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="he" dir="rtl">
      <body style={{ margin: 0 }}>
        <RouteError error={error} reset={reset} />
      </body>
    </html>
  );
}
