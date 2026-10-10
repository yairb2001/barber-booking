import { NextResponse } from "next/server";
import { getPlans } from "@/lib/crm/plans";

export const dynamic = "force-dynamic";

/** Public: the plans as the signup page shows them (no costs, no AI budget). */
export async function GET() {
  const plans = await getPlans();
  return NextResponse.json({
    plans: plans.filter(p => p.active).map(p => ({ key: p.key, name: p.name, apptsEstimate: p.apptsCap, messages: p.messages, priceIls: p.priceIls })),
  });
}
