import { NextRequest, NextResponse } from "next/server";
import { getSessionBusiness, requireOwner } from "@/lib/session";
import { usageFor } from "@/lib/crm/plans";
import { onFreePackage, freePackageState } from "@/lib/agent/free-package";

export const dynamic = "force-dynamic";

/**
 * הבר של חבילת הסוכן בתחתית תפריט הצד (26.10.2026, יאיר): כמה אחוז מהחבילה נוצלו.
 * לבעל העסק בלבד, ורק אחוזים, אף פעם לא כסף (כמו במסך המסלול).
 * בחבילה החינמית: המלא מבין השניים (הודעות או סוכן), כי הוא מה שעוצר את הסוכן.
 */
export async function GET(req: NextRequest) {
  const guard = requireOwner(req);
  if (guard) return guard;
  const biz = await getSessionBusiness(req, { id: true, createdAt: true, paidAt: true });
  if (!biz) return NextResponse.json({ error: "No business" }, { status: 400 });
  if (onFreePackage(biz)) {
    const f = await freePackageState(biz);
    return NextResponse.json({ free: true, pct: f.pct });
  }
  const ai = (await usageFor([biz.id])).get(biz.id)?.ai;
  return NextResponse.json({ free: false, pct: ai && ai.cap > 0 ? ai.pct : null });
}
