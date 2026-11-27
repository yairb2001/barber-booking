/**
 * Holidays the business stays open on (27.11.2026: "חנוכה 25.12 עד 2.1", made up by the model). The dates come
 * from here; whether the business works differently on them is the owner's, never the agent's guess.
 */
import { israeliHoliday } from "@/lib/israeli-holidays";
import { addDaysISO } from "@/lib/utils";

const SEASONS: { name: string; from: string; to: string; words: RegExp }[] = [
  { name: "חנוכה", from: "2026-12-04", to: "2026-12-12", words: /חנוכה|hanukk?ah|chanukk?ah|ханук|حانوكا|חנוכא/i },
  { name: "חנוכה", from: "2027-12-24", to: "2028-01-01", words: /חנוכה|hanukk?ah|chanukk?ah|ханук|حانوكا|חנוכא/i },
];
const dm = (iso: string) => `${Number(iso.slice(8))}.${Number(iso.slice(5, 7))}`;

/** A line for the agent when he asks about a holiday: its real dates, and what to do about hours. */
export function seasonLine(text: string, today: string): string {
  const s = SEASONS.find(x => x.words.test(text) && x.to >= today);
  const closed = Array.from({ length: 30 }, (_, i) => addDaysISO(today, i)).map(d => [d, israeliHoliday(d)] as const).filter(([, h]) => h);
  const holidayAsk = /חג|holiday|праздник|عيد/i.test(text);
  if (!s && !holidayAsk) return "";
  const parts: string[] = [];
  if (s) parts.push(`${s.name} השנה: מ-${dm(s.from)} בערב עד ${dm(s.to)}.`);
  if (holidayAsk && closed.length) parts.push(`חגים ב-30 הימים הקרובים: ${closed.map(([d, h]) => `${h} ${dm(d)}`).join(", ")}.`);
  parts.push("שעות מיוחדות לחג לא כתובות במערכת: ענה לפי השעות הרגילות שבזמינות, ואם שואלים אם פתוחים או סגורים בחג → ask_owner. אל תמציא שעות או תאריכים.");
  return parts.join(" ");
}
