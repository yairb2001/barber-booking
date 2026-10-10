import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { verifyPaySig } from "@/lib/billing/pay-link";
import { getPlans, planKeyOf } from "@/lib/crm/plans";
import PayForm from "./PayForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "צ'אטור · המשך מנוי", robots: { index: false } };

/** The owner's personal card page (10.10.2026). No login; the link is signed. */
export default async function PayPage({ params }: { params: { slug: string; sig: string } }) {
  const biz = await prisma.business.findUnique({ where: { slug: decodeURIComponent(params.slug) }, select: { id: true, name: true, settings: true, paidAt: true, trialEndsAt: true, monthlyPrice: true } });
  if (!biz || !verifyPaySig(biz.id, params.sig)) notFound();
  const plan = (await getPlans()).find(p => p.key === planKeyOf(biz.settings)) ?? null;
  let s: Record<string, unknown> = {};
  try { s = biz.settings ? JSON.parse(biz.settings) : {}; } catch { /* ignore */ }
  const ends = biz.trialEndsAt && biz.trialEndsAt > new Date() ? biz.trialEndsAt.toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "numeric", timeZone: "Asia/Jerusalem" }) : null;
  const price = plan?.priceIls ?? biz.monthlyPrice ?? null;

  return (
    <div className="min-h-screen px-4 py-8 flex items-center justify-center font-heebo" dir="rtl" style={{ background: "#0B3A3C" }}>
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@600;700&display=swap" rel="stylesheet" />
      <div className="w-full max-w-sm">
        <div className="flex items-baseline justify-center gap-2 mb-5">
          <span className="text-3xl font-bold tracking-tight text-white" style={{ fontFamily: "Outfit, Heebo, sans-serif" }}>Chator</span>
          <span className="text-xs" style={{ color: "#4FE3B1" }}>צ׳אטור</span>
        </div>
        <div className="bg-white rounded-3xl p-5 shadow-xl space-y-4">
          {biz.paidAt ? (
            <div className="text-center space-y-2 py-4">
              <h1 className="text-xl font-bold text-slate-900">המנוי של {biz.name} פעיל ✓</h1>
              <p className="text-sm text-slate-500">אין צורך לעשות כלום. החשבוניות מגיעות למייל.</p>
            </div>
          ) : (
            <>
              <div>
                <h1 className="text-xl font-bold text-slate-900">ממשיכים עם צ׳אטור</h1>
                <p className="text-sm text-slate-500 mt-1">{biz.name}{ends ? ` · החודש החינמי מסתיים ב${ends}` : ""}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 p-4">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold text-slate-800">{plan ? `מסלול ${plan.name}` : "המנוי החודשי"}</span>
                  {price ? <span className="text-2xl font-bold text-slate-900 tabular-nums">{price} ₪<span className="text-xs font-normal text-slate-500"> לחודש</span></span> : null}
                </div>
                {plan && <p className="text-xs text-slate-500 mt-1">{plan.messages.toLocaleString("he-IL")} הודעות וואטסאפ בחודש · תורים בלי הגבלה · הסוכן בוואטסאפ</p>}
              </div>
              <PayForm slug={params.slug} sig={params.sig} defaultName={typeof s.ownerName === "string" ? s.ownerName : ""} defaultEmail={typeof s.billingEmail === "string" ? s.billingEmail : ""} />
              <p className="text-[11px] text-slate-400 leading-relaxed">התשלום מאובטח ומתבצע בדף הסליקה של אינוויס. החיוב חודשי, עם חשבונית במייל בכל חודש. אפשר לשנות מסלול או להפסיק בכל רגע.</p>
            </>
          )}
        </div>
        <p className="text-center text-[11px] mt-4" style={{ color: "rgba(255,255,255,0.6)" }}>רוצה לדבר עם נציג? כתוב לנו בוואטסאפ ונארגן.</p>
      </div>
    </div>
  );
}
