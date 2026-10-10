/** Shapes of GET /api/admin/plan (the owner's "המסלול שלי"). */
export type Meter = { used: number; cap: number; pct: number };
export type PlanData = {
  planKey: string | null;
  plans: { key: string; name: string; apptsCap: number; messages: number; priceIls: number }[];
  usage: { month: string; appts: Meter; messages: Meter; marketing: Meter; aiPct: number } | null;
  packs: { id: string; kind: "messages" | "ai" | "marketing"; qty: number | null; priceIls: number; month: string }[];
  packPrices: Record<"messages" | "ai" | "marketing", { qty: number | null; price: number }>;
  invoices: { id: string; number: string | null; issuedAt: string; amountIls: number; status: string; pdfUrl: string | null }[];
  trialEndsAt: string | null;
  paying: boolean;
  monthlyPrice: number | null;
  requested: Record<string, string>;
  payUrl: string | null;
  referral: { link: string; friends: { name: string; paying: boolean; at: string }[]; earned: number; applied: number };
};

export const barColor = (pct: number) => (pct >= 100 ? "bg-red-500" : pct >= 80 ? "bg-amber-400" : "bg-teal-500");
export const n = (x: number) => x.toLocaleString("he-IL");
export const shortDate = (iso: string) => new Date(iso).toLocaleDateString("he-IL", { day: "numeric", month: "numeric", year: "2-digit", timeZone: "Asia/Jerusalem" });
