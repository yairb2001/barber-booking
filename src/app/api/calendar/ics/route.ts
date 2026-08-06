import { NextRequest, NextResponse } from "next/server";

/**
 * Serves a .ics file with real Content-Type/Content-Disposition headers.
 *
 * The "Apple / other" add-to-calendar link previously used a `data:text/
 * calendar,...` URI with a `download` attribute — mobile Safari and in-app
 * WebViews (e.g. WhatsApp's browser, which is how most customers reach this
 * page) largely ignore `download` on data: URIs, so the file never actually
 * saved. A real HTTP response with the correct headers is what every
 * platform's calendar-import handling actually expects.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const title    = searchParams.get("title")    || "תור";
  const date     = searchParams.get("date")     || ""; // YYYY-MM-DD
  const time     = searchParams.get("time")     || ""; // HH:MM
  const duration = Number(searchParams.get("duration")) || 30;
  const details  = searchParams.get("details")  || "";
  const location = searchParams.get("location") || "";

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
    return NextResponse.json({ error: "invalid date/time" }, { status: 400 });
  }

  const pad = (n: number) => String(n).padStart(2, "0");
  const [y, mo, d] = date.split("-");
  const [hh, mm] = time.split(":").map(Number);
  const startMin = hh * 60 + mm;
  const endMin = startMin + duration;
  const startStr = `${y}${mo}${d}T${pad(hh)}${pad(mm)}00`;
  const endStr = `${y}${mo}${d}T${pad(Math.floor(endMin / 60) % 24)}${pad(endMin % 60)}00`;
  const stampStr = new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";

  const ics = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//DOMINANT//Booking//HE",
    "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "BEGIN:VEVENT",
    `UID:${startStr}-${Math.random().toString(36).slice(2)}@dominant`,
    `DTSTAMP:${stampStr}`,
    `DTSTART;TZID=Asia/Jerusalem:${startStr}`,
    `DTEND;TZID=Asia/Jerusalem:${endStr}`,
    `SUMMARY:${title.replace(/\n/g, " ")}`,
    `DESCRIPTION:${details.replace(/\n/g, "\\n")}`,
    `LOCATION:${location.replace(/\n/g, " ")}`,
    "BEGIN:VALARM", "TRIGGER:-PT2H", "ACTION:DISPLAY", "DESCRIPTION:תזכורת לתור",
    "END:VALARM", "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n");

  return new NextResponse(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="appointment.ics"',
      "Cache-Control": "no-store",
    },
  });
}
