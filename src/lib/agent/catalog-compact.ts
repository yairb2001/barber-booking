/**
 * The staff-and-services block for every business but a men's barbershop
 * (28.10.2026, spec "הקמה עצמית ליופי"). Each service once, under its category,
 * with who does it; the team once, with ids. The per-staff list it replaces
 * repeated every service for every staff member, so a women's salon with the
 * starter catalog and four stylists passed the 4,500-character cap and the
 * agent lost the whole list. The categories are what the agent asks by when
 * the customer has not named a service (prompt-template.ts).
 */
import { staffFemOf, type Vocab } from "@/lib/vocab";

type Svc = { id: string; name: string; price: number; durationMinutes: number; note: string | null; category: string | null; priceFrom?: boolean };
type Own = { customName: string | null; customPrice: number | null; customDuration: number | null; customNote: string | null; service: { id: string } };
type StaffRow = {
  id: string; name: string; nickname: string | null; inQuickPool: boolean; gender: string | null;
  staffServices: Own[];
};

// "החל מ" (a price set at a consultation) rides along, so the agent never quotes it as the price.
const line = (name: string, price: number, dur: number, note: string | null, from = false) => `${name} ${from ? "החל מ-" : ""}${price}₪/${dur} דק׳${note ? ` (${note})` : ""}`;

export function compactCatalog(staff: StaffRow[], services: Svc[], v: Vocab): { header: string; body: string } {
  const hasPool = staff.some(s => s.inQuickPool);
  const team = staff.map(s => {
    const fem = staffFemOf(s, v);
    const mark = s.gender === "x" ? " (בלי מגדר: אמור רק את השם, בלי היא או הוא)" : fem === v.staffFem ? "" : fem ? " (אישה)" : " (גבר)";
    const pool = hasPool && !s.inQuickPool ? ` (לא ${fem ? "מציעים אותה" : "מציעים אותו"} ביוזמתנו; רק בשם או ${fem ? "כשהיא הקבועה" : "כשהוא הקבוע"})` : "";
    return `${s.name}${mark}${s.nickname ? ` (${s.nickname})` : ""} [id: ${s.id}]${pool}`;
  });
  // Who does each service: her own rows, or every service for someone with no rows (as the per-staff list read it).
  const rows = services.map(sv => {
    const by = staff.flatMap((s): { s: StaffRow; own: Own | null }[] => {
      if (!s.staffServices.length) return [{ s, own: null }];
      const own = s.staffServices.find(x => x.service.id === sv.id);
      return own ? [{ s, own }] : [];
    });
    if (!by.length) return null;
    const own = by.filter(b => b.own && (b.own.customName || b.own.customPrice != null || b.own.customDuration != null || b.own.customNote))
      .map(({ s, own: o }) => `אצל ${s.name}: ${line(o!.customName ?? sv.name, o!.customPrice ?? sv.price, o!.customDuration ?? sv.durationMinutes, o!.customNote ?? sv.note, sv.priceFrom)}`);
    return { cat: sv.category?.trim() || "", text: `• ${line(sv.name, sv.price, sv.durationMinutes, sv.note, sv.priceFrom)} [id: ${sv.id}] · אצל: ${by.map(b => b.s.name).join(", ")}${own.length ? ` (${own.join("; ")})` : ""}` };
  }).filter((r): r is { cat: string; text: string } => !!r);
  const cats = Array.from(new Set(rows.map(r => r.cat)));
  const grouped = cats.length > 1 || cats[0]
    ? cats.map(c => `${c || "שירותים נוספים"}:\n${rows.filter(r => r.cat === c).map(r => r.text).join("\n")}`).join("\n")
    : rows.map(r => r.text).join("\n");
  return {
    header: `${v.staffPluralDef} והשירותים (עדכני. ליד כל שירות כתוב אצל מי עושים אותו, ורק אצלם קובעים אותו. המזהים בסוגריים הם מה שמעבירים לכלים — אין צורך לקרוא ל-get_staff_list או ל-get_services):`,
    body: `${v.staffPluralDef}: ${team.join("; ")}\n${grouped}`,
  };
}
