/**
 * The customer's messages for group classes (16.10.2026): got a spot, in line,
 * a spot opened for her, the session was cancelled. Neutral Hebrew; the send
 * layer puts them in the business's words (type-wording.ts).
 */
import { prisma } from "@/lib/prisma";
import { sendMessage } from "@/lib/messaging";
import type { MessageKind } from "@/lib/messaging/types";
import { dayLabelWithDistance } from "@/lib/agent/booking-proposals";

type Kind = Extract<MessageKind, "class_booked" | "class_waitlist" | "class_promoted" | "class_cancelled">;

export async function notifyClass(kind: Kind, p: { sessionId: string; customerId: string; position?: number }): Promise<void> {
  const [s, c] = await Promise.all([
    prisma.classSession.findUnique({ where: { id: p.sessionId }, select: { businessId: true, date: true, startTime: true, staffId: true, classType: { select: { name: true } } } }),
    prisma.customer.findUnique({ where: { id: p.customerId }, select: { name: true, phone: true } }),
  ]);
  if (!s || !c?.phone) return;
  const staff = s.staffId ? await prisma.staff.findUnique({ where: { id: s.staffId }, select: { name: true } }) : null;
  const first = (c.name || "").trim().split(/\s+/)[0] || "";
  const when = `${dayLabelWithDistance(s.date.toISOString().slice(0, 10))} ב-${s.startTime}`;
  const what = `${s.classType.name} ${when}${staff ? ` עם ${staff.name}` : ""}`;
  const body =
    kind === "class_booked" ? `היי ${first}, נרשמת ל${what} ✅\nאם משהו משתנה, אפשר לכתוב כאן ונבטל.`
    : kind === "class_waitlist" ? `היי ${first}, ${what} מלא כרגע. נכנסת לרשימת ההמתנה (מקום ${p.position ?? 1}). אם יתפנה מקום, נרשום אותך אוטומטית ונשלח הודעה.`
    : kind === "class_promoted" ? `היי ${first}, התפנה מקום ב${what} ונרשמת ✅\nאם זה כבר לא מתאים, אפשר לכתוב כאן ונבטל.`
    : `היי ${first}, ${what} בוטל. מצטערים על השינוי 🙏`;
  await sendMessage({ businessId: s.businessId, customerPhone: c.phone, kind, body }).catch(() => {});
}
