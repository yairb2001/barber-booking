import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner, getSessionBusiness } from "@/lib/session";

// Source-merge (alias) map — owner-only.
//
// Lets the owner fold several raw referral sources into one canonical label so
// the marketing dashboard stops showing (say) "ig", "אינסטגרם" and "instagram"
// as three separate rows. Stored in Business.settings.refAliases as a plain
// object: { [rawSource]: canonicalLabel }. A raw source with NO entry is left
// untouched — it simply appears as its own row (i.e. "add new" by default).
//
// The map is applied at READ time when aggregating stats (see
// analytics/referral-stats), so it's non-destructive and retroactive.

type AliasMap = Record<string, string>;

function readAliases(settingsJson: string | null): AliasMap {
  try {
    const s = settingsJson ? JSON.parse(settingsJson) : {};
    const a = s?.refAliases;
    if (a && typeof a === "object" && !Array.isArray(a)) return a as AliasMap;
  } catch { /* fall through */ }
  return {};
}

// GET → { aliases, sources } — the current map plus every distinct raw source
// (with its customer count) so the editor can list them.
export async function GET(req: NextRequest) {
  const guard = requireOwner(req);
  if (guard) return guard;

  const business = await getSessionBusiness(req, { id: true, settings: true });
  if (!business) return NextResponse.json({ aliases: {}, sources: [] });

  const grouped = await prisma.customer.groupBy({
    by: ["referralSource"],
    where: { businessId: business.id, deletedAt: null, referralSource: { not: null } },
    _count: { _all: true },
  });

  const sources = grouped
    .map(g => ({ source: (g.referralSource ?? "").trim(), count: g._count._all }))
    .filter(s => s.source)
    .sort((a, b) => b.count - a.count);

  return NextResponse.json({ aliases: readAliases(business.settings), sources });
}

// PUT { aliases } → replace the alias map (merged into settings JSON).
export async function PUT(req: NextRequest) {
  const guard = requireOwner(req);
  if (guard) return guard;

  const body = await req.json().catch(() => ({}));
  const incoming = body?.aliases;
  if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
    return NextResponse.json({ error: "aliases object required" }, { status: 400 });
  }

  // Sanitise: keep only string→non-empty-string pairs where the target differs
  // from the source (a self-map is a no-op and just clutters the object).
  const clean: AliasMap = {};
  for (const [raw, target] of Object.entries(incoming as Record<string, unknown>)) {
    const from = String(raw).trim();
    const to = typeof target === "string" ? target.trim() : "";
    if (from && to && from !== to) clean[from] = to.slice(0, 120);
  }

  const business = await getSessionBusiness(req, { id: true, settings: true });
  if (!business) return NextResponse.json({ error: "No business" }, { status: 400 });

  let settings: Record<string, unknown> = {};
  try { settings = business.settings ? JSON.parse(business.settings) : {}; } catch { settings = {}; }
  settings.refAliases = clean;

  await prisma.business.update({
    where: { id: business.id },
    data: { settings: JSON.stringify(settings) },
  });

  return NextResponse.json({ ok: true, aliases: clean });
}
