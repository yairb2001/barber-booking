import { prisma } from "@/lib/prisma";
import type { MessageKind, MessagingProvider, SendResult } from "./types";
import { GreenApiProvider } from "./green-api";

/** Build provider from business config. Returns null if provider is "none". */
export function providerForBusiness(business: {
  messagingProvider: string | null;
  whatsappNumber: string | null;
  greenApiInstanceId: string | null;
  greenApiToken: string | null;
}): MessagingProvider | null {
  const kind = business.messagingProvider || "green_api";
  if (kind === "green_api") {
    return new GreenApiProvider({
      whatsappNumber: business.whatsappNumber,
      greenApiInstanceId: business.greenApiInstanceId,
      greenApiToken: business.greenApiToken,
    });
  }
  // future: meta_cloud
  return null;
}

/** Check if business has reminders feature enabled. */
export function hasFeature(
  features: string | null,
  flag: "reminders" | "agent"
): boolean {
  if (!features) return true; // default: enabled during development
  try {
    const parsed = JSON.parse(features) as Record<string, boolean>;
    return parsed[flag] ?? true;
  } catch {
    return true;
  }
}

/**
 * Send a WhatsApp message and log it to MessageLog.
 * Silently no-ops if the business has no provider configured (to avoid breaking flows).
 */
export async function sendMessage(opts: {
  businessId: string;
  appointmentId?: string;
  customerPhone: string;
  kind: MessageKind;
  body: string;
}): Promise<SendResult> {
  const business = await prisma.business.findUnique({
    where: { id: opts.businessId },
  });
  if (!business) return { ok: false, error: "Business not found" };

  // Pre-create log entry (queued)
  const log = await prisma.messageLog.create({
    data: {
      businessId: opts.businessId,
      appointmentId: opts.appointmentId || null,
      customerPhone: opts.customerPhone,
      kind: opts.kind,
      body: opts.body,
      status: "queued",
    },
  });

  const provider = providerForBusiness(business);
  if (!provider || !provider.isConfigured()) {
    await prisma.messageLog.update({
      where: { id: log.id },
      data: { status: "failed", error: "provider_not_configured" },
    });
    return { ok: false, error: "provider_not_configured" };
  }

  const result = await provider.sendText(opts.customerPhone, opts.body);

  await prisma.messageLog.update({
    where: { id: log.id },
    data: {
      status: result.ok ? "sent" : "failed",
      providerId: result.providerId,
      error: result.error,
      sentAt: result.ok ? new Date() : null,
    },
  });

  return result;
}

// ── Message templates ──────────────────────────────────────────────────────────

export function confirmationText(params: {
  customerName: string;
  businessName: string;
  staffName: string;
  serviceName: string;
  dateLabel: string; // "יום שני, 14 אפריל"
  startTime: string; // "14:30"
  endTime: string;   // "15:00"
  price: number;
  address?: string | null;
}): string {
  const lines = [
    `שלום ${params.customerName} 👋`,
    ``,
    `תור נקבע בהצלחה ב*${params.businessName}* ✂️`,
    `📅 ${params.dateLabel}`,
    `🕒 ${params.startTime} – ${params.endTime}`,
    `💈 ${params.serviceName} אצל ${params.staffName}`,
    `💰 ${params.price}₪`,
  ];
  if (params.address) lines.push(``, `📍 ${params.address}`);
  lines.push(``, `נתראה!`);
  return lines.join("\n");
}

export function reminder24hText(params: {
  customerName: string;
  businessName: string;
  staffName: string;
  startTime: string;
  dateLabel: string;
  address?: string | null;
}): string {
  const lines = [
    `שלום ${params.customerName} 👋`,
    ``,
    `תזכורת — יש לך תור מחר ב*${params.businessName}* ✂️`,
    `📅 ${params.dateLabel}`,
    `🕒 ${params.startTime}`,
    `💈 אצל ${params.staffName}`,
  ];
  if (params.address) lines.push(``, `📍 ${params.address}`);
  lines.push(``, `אם יש שינוי — נא להודיע מראש 🙏`);
  return lines.join("\n");
}
