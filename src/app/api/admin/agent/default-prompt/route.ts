import { NextRequest, NextResponse } from "next/server";
import { getSessionBusiness, requireOwner } from "@/lib/session";
import { defaultAgentBody } from "@/lib/agent/customer-agent";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const guard = requireOwner(req);
  if (guard) return guard;
  const biz = await getSessionBusiness(req, { name: true });

  // The editable personality/rules body. Date, customer memory and FAQs are
  // injected automatically at runtime — they're intentionally not shown here.
  const prompt = defaultAgentBody("הסוכן", biz?.name ?? "המספרה");

  return NextResponse.json({ prompt });
}
