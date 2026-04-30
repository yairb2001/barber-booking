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

/** Check if business has a feature enabled. */
export function hasFeature(
  features: string | null,
  flag: "reminders" | "reminder_24h" | "reminder_2h" | "agent"
): boolean {
  if (!features) {
    // Defaults: reminders=on, 24h=on, 2h=off, agent=off
    return flag === "reminders" || flag === "reminder_24h";
  }
  try {
    const f = JSON.parse(features) as Record<string, boolean>;
    if (flag === "reminder_24h") {
      // Fall back to legacy "reminders" key for backward compat
      return f.reminder_24h ?? f.reminders ?? true;
    }
    if (flag === "reminder_2h") {
      return f.reminder_2h ?? false;
    }
    return f[flag] ?? (flag === "reminders");
  } catch {
    return flag === "reminders" || flag === "reminder_24h";
  }
}

// ── Template engine ────────────────────────────────────────────────────────────

/** Replace {{variable}} placeholders in a template string. */
export function applyTemplate(
  template: string,
  vars: Record<string, string>
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? "");
}

/** Default template for 24-hour reminder. Uses {{variable}} placeholders. */
export const DEFAULT_24H_TEMPLATE =
`שלום {{name}} 👋

תזכורת — יש לך תור מחר ב*{{business}}* ✂️
📅 {{date}}
🕒 {{time}}
💈 אצל {{staff}}{{address_line}}

אם יש שינוי — נא להודיע מראש 🙏`;

/** Default template for 2-hour reminder. */
export const DEFAULT_2H_TEMPLATE =
`שלום {{name}} 👋

תזכורת — יש לך תור בעוד שעתיים ב*{{business}}* ✂️
🕒 {{time}}
💈 אצל {{staff}}{{address_line}}

נתראה בקרוב! 💈`;

/** Build reminder vars from appointment data. */
export function reminderVars(params: {
  customerName: string;
  businessName: string;
  staffName: string;
  startTime: string;
  dateLabel: string;
  address?: string | null;
}): Record<string, string> {
  return {
    name: params.customerName,
    business: params.businessName,
    staff: params.staffName,
    time: params.startTime,
    date: params.dateLabel,
    address_line: params.address ? `\n📍 ${params.address}` : "",
  };
}

/**
 * Send a WhatsApp message and log it to MessageLog.
 * Silently no-ops if the business has no provider configured.
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

// ── Message templates (legacy helpers — still used for confirmation) ───────────

export function confirmationText(params: {
  customerName: string;
  businessName: string;
  staffName: string;
  serviceName: string;
  dateLabel: string;
  startTime: string;
  endTime: string;
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

// ── Swap-flow templates ──────────────────────────────────────────────────────

/**
 * Sent to candidate customer asking if they'd trade their slot for the
 * primary customer's slot. The customer is expected to reply "כן" or "לא"
 * (free-text — admin reads the reply and marks the response in the UI).
 */
export function swapProposalText(params: {
  candidateName: string;
  businessName: string;
  candidateDateLabel: string;
  candidateTime: string;
  primaryDateLabel: string;
  primaryTime: string;
  primaryStaffName: string;
}): string {
  return [
    `שלום ${params.candidateName} 👋`,
    ``,
    `*${params.businessName}* ✂️`,
    `מבקשים ממך לשקול החלפת תור.`,
    ``,
    `התור הנוכחי שלך:`,
    `📅 ${params.candidateDateLabel}`,
    `🕒 ${params.candidateTime}`,
    ``,
    `התור המוצע במקומו:`,
    `📅 ${params.primaryDateLabel}`,
    `🕒 ${params.primaryTime}`,
    `💈 ${params.primaryStaffName}`,
    ``,
    `מסכים? ענה *כן* או *לא* 🙏`,
  ].join("\n");
}

/**
 * Sent to BOTH customers when admin approves the swap.
 * Confirms each customer's NEW slot details.
 */
export function swapConfirmationText(params: {
  customerName: string;
  businessName: string;
  newDateLabel: string;
  newTime: string;
  newStaffName: string;
  serviceName: string;
}): string {
  return [
    `שלום ${params.customerName} ✓`,
    ``,
    `ההחלפה אושרה ב*${params.businessName}* 🤝`,
    ``,
    `התור החדש שלך:`,
    `📅 ${params.newDateLabel}`,
    `🕒 ${params.newTime}`,
    `💈 ${params.serviceName} אצל ${params.newStaffName}`,
    ``,
    `תודה על הגמישות 🙏`,
  ].join("\n");
}

/**
 * Sent to a customer when admin moves their appointment to a new slot
 * (via drag-to-move) and chooses to notify them.
 */
export function appointmentMovedText(params: {
  customerName: string;
  businessName: string;
  newDateLabel: string;
  newTime: string;
  newStaffName: string;
  serviceName: string;
}): string {
  return [
    `שלום ${params.customerName} 👋`,
    ``,
    `התור שלך ב*${params.businessName}* עודכן.`,
    ``,
    `הזמן החדש:`,
    `📅 ${params.newDateLabel}`,
    `🕒 ${params.newTime}`,
    `💈 ${params.serviceName} אצל ${params.newStaffName}`,
    ``,
    `אם יש בעיה — נא להודיע. אחרת נתראה! 🙏`,
  ].join("\n");
}
