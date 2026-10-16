import { NextRequest, NextResponse } from "next/server";
import { getSessionBusiness, requireOwner } from "@/lib/session";
import { planFreeText, applyFreeText } from "@/lib/agent/free-text";

/**
 * The owner's own words about his agent (16.10.2026): {action:"plan", text} shows
 * how the agent will understand them; {action:"apply", plan} saves that.
 * src/lib/agent/free-text.ts.
 */
export async function POST(req: NextRequest) {
  const guard = requireOwner(req);
  if (guard) return guard;
  const biz = await getSessionBusiness(req, { id: true });
  if (!biz) return NextResponse.json({ error: "no business" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  try {
    if (body.action === "plan") {
      const text = typeof body.text === "string" ? body.text.trim() : "";
      if (text.length < 3) return NextResponse.json({ error: "תכתוב מה חשוב לך" }, { status: 400 });
      return NextResponse.json({ plan: await planFreeText(biz.id, text) });
    }
    if (body.action === "apply" && body.plan && typeof body.plan === "object") {
      return NextResponse.json({ ok: true, plan: await applyFreeText(biz.id, body.plan, body.author === "wizard" ? "wizard" : "owner") });
    }
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  } catch (e) {
    console.error("[free-text]", e);
    return NextResponse.json({ error: "לא הצלחתי לעבד את זה כרגע. נסה שוב בעוד רגע." }, { status: 502 });
  }
}
