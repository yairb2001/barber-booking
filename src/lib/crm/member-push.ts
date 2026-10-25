/**
 * Pushes for the CRM's reports-only members (25.10.2026): "יש משהו שמחכה לך
 * במסך הדיווחים". Their phones are kept apart from Yair's (crmWebPushSubs in
 * the platform business, notify.ts): crm_settings "crmMemberPushSubs", a list
 * of devices per member id. Same VAPID pair as the rest of the app. An "admin"
 * member (Nika) gets the CRM's own pushes, like Yair, not these.
 *
 * Two pushes only: a shop filed a report (feedback route), and the morning fix
 * agent left fixes waiting for approval (fix-agent.ts notify). Both open the
 * reports screen.
 */
import webpush from "web-push";
import { prisma } from "@/lib/prisma";
import { VAPID_PUBLIC_KEY, type WebPushSub } from "@/lib/native/web-push";
import { getMembers } from "@/lib/crm/members";

const KEY = "crmMemberPushSubs";
const PLATFORM_BUSINESS_ID = process.env.SUPER_ADMIN_BUSINESS_ID || "c8e1ac89-32d1-4e00-b493-2e95aef4d8f2";
type Subs = Record<string, WebPushSub[]>;

async function load(): Promise<Subs> {
  const row = await prisma.crmSetting.findUnique({ where: { key: KEY } }).catch(() => null);
  try { const v = row ? JSON.parse(row.value) : {}; return v && typeof v === "object" && !Array.isArray(v) ? v : {}; } catch { return {}; }
}
async function save(subs: Subs) {
  const value = JSON.stringify(subs);
  await prisma.crmSetting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } });
}

export async function addMemberPushSub(memberId: string, sub: WebPushSub): Promise<void> {
  const all = await load();
  all[memberId] = [...(all[memberId] ?? []).filter(x => x.endpoint !== sub.endpoint), sub].slice(-5);
  await save(all);
}

export async function removeMemberPushSub(memberId: string, endpoint: string): Promise<void> {
  const all = await load();
  if (!all[memberId]) return;
  all[memberId] = all[memberId].filter(x => x.endpoint !== endpoint);
  if (!all[memberId].length) delete all[memberId];
  await save(all);
}

export async function memberPushHas(memberId: string, endpoint: string): Promise<boolean> {
  return ((await load())[memberId] ?? []).some(x => x.endpoint === endpoint);
}

/** One short push to every reports member's phones. Never throws; returns how many went out. */
export async function pushReportsMembers(p: { title: string; body: string; url?: string; tag?: string }): Promise<number> {
  try {
    const all = await load();
    const members = new Set((await getMembers()).filter(m => m.scope === "reports").map(m => m.id));
    const targets = Object.entries(all).filter(([id, subs]) => members.has(id) && subs.length);
    if (!targets.length) return 0;
    const biz = await prisma.business.findUnique({ where: { id: PLATFORM_BUSINESS_ID }, select: { settings: true } });
    let s: Record<string, unknown> = {};
    try { s = biz?.settings ? JSON.parse(biz.settings) : {}; } catch { /* env key */ }
    const key = typeof s.vapidPrivateKey === "string" && s.vapidPrivateKey ? s.vapidPrivateKey : process.env.VAPID_PRIVATE_KEY;
    if (!key) return 0;
    webpush.setVapidDetails("mailto:yair9051@gmail.com", VAPID_PUBLIC_KEY, key);
    const payload = JSON.stringify({ title: p.title.slice(0, 80), body: p.body.slice(0, 120), url: p.url ?? "/admin/crm/reports", tag: p.tag });
    const dead = new Set<string>();
    let sent = 0;
    await Promise.all(targets.flatMap(([, subs]) => subs.map(async sub => {
      try { await webpush.sendNotification(sub as webpush.PushSubscription, payload); sent++; }
      catch (e) { const code = (e as { statusCode?: number }).statusCode; if (code === 404 || code === 410) dead.add(sub.endpoint); }
    })));
    if (dead.size) {
      const fresh = await load();
      for (const id of Object.keys(fresh)) { fresh[id] = fresh[id].filter(x => !dead.has(x.endpoint)); if (!fresh[id].length) delete fresh[id]; }
      await save(fresh);
    }
    return sent;
  } catch (e) {
    console.error("[crm-member-push]", e);
    return 0;
  }
}
