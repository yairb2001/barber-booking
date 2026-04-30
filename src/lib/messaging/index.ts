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

// ── Default templates ────────────────────────────────────────────────────────
// Each is a string with {{variable}} placeholders. Admins can override these
// per-business via the /admin/templates UI; if their override is null, the
// default is used.

export const DEFAULT_CONFIRMATION_TEMPLATE =
`שלום {{name}} 👋

תור נקבע בהצלחה ב*{{business}}* ✂️
📅 {{date}}
🕒 {{time}} – {{end_time}}
💈 {{service}} אצל {{staff}}
💰 {{price}}₪{{address_line}}

נתראה!`;

export const DEFAULT_SWAP_PROPOSAL_TEMPLATE =
`שלום {{name}} 👋

*{{business}}* ✂️
מבקשים ממך לשקול החלפת תור.

התור הנוכחי שלך:
📅 {{current_date}}
🕒 {{current_time}}

התור המוצע במקומו:
📅 {{proposed_date}}
🕒 {{proposed_time}}
💈 {{proposed_staff}}

מסכים? ענה *כן* או *לא* 🙏`;

export const DEFAULT_MOVE_PROPOSAL_TEMPLATE =
`שלום {{name}} 👋

*{{business}}* ✂️
אנחנו צריכים להזיז את התור שלך.

התור הנוכחי שלך:
📅 {{current_date}}
🕒 {{current_time}}

יש לך אפשרות לעבור ל:
📅 {{proposed_date}}
🕒 {{proposed_time}}
💈 {{proposed_staff}}

מתאים? ענה *כן* או *לא* 🙏`;

export const DEFAULT_SWAP_CONFIRMATION_TEMPLATE =
`שלום {{name}} ✓

ההחלפה אושרה ב*{{business}}* 🤝

התור החדש שלך:
📅 {{date}}
🕒 {{time}}
💈 {{service}} אצל {{staff}}

תודה על הגמישות 🙏`;

export const DEFAULT_APPOINTMENT_MOVED_TEMPLATE =
`שלום {{name}} 👋

התור שלך ב*{{business}}* עודכן.

הזמן החדש:
📅 {{date}}
🕒 {{time}}
💈 {{service}} אצל {{staff}}

אם יש בעיה — נא להודיע. אחרת נתראה! 🙏`;

export const DEFAULT_DELAY_NOTIFICATION_TEMPLATE =
`שלום {{name}} 👋

עדכון מ*{{business}}* ✂️
התור שלך ב-{{time}} מתעכב בכ-*{{delay_minutes}} דקות*.

מצטערים על אי הנוחות 🙏`;

/** All editable template definitions (used by the /admin/templates UI). */
export const TEMPLATE_DEFS = {
  confirmation: {
    label: "אישור קביעת תור",
    description: "נשלח ללקוח מיד אחרי שתור נקבע (חדש או דרך האדמין).",
    field: "confirmationTemplate" as const,
    default: DEFAULT_CONFIRMATION_TEMPLATE,
    variables: [
      { key: "name",         label: "שם הלקוח" },
      { key: "business",     label: "שם העסק" },
      { key: "date",         label: "תאריך מלא" },
      { key: "time",         label: "שעת התחלה" },
      { key: "end_time",     label: "שעת סיום" },
      { key: "staff",        label: "שם הספר" },
      { key: "service",      label: "שם השירות" },
      { key: "price",        label: "מחיר" },
      { key: "address_line", label: "כתובת (שורה נפרדת אם קיימת)" },
    ],
  },
  reminder_24h: {
    label: "תזכורת 24 שעות לפני",
    description: "תזכורת יום לפני התור.",
    field: "reminder24hTemplate" as const,
    default: DEFAULT_24H_TEMPLATE,
    variables: [
      { key: "name",         label: "שם הלקוח" },
      { key: "business",     label: "שם העסק" },
      { key: "date",         label: "תאריך" },
      { key: "time",         label: "שעת התחלה" },
      { key: "staff",        label: "שם הספר" },
      { key: "address_line", label: "כתובת" },
    ],
  },
  reminder_2h: {
    label: "תזכורת שעתיים לפני",
    description: "תזכורת קרובה לתור.",
    field: "reminder2hTemplate" as const,
    default: DEFAULT_2H_TEMPLATE,
    variables: [
      { key: "name",         label: "שם הלקוח" },
      { key: "business",     label: "שם העסק" },
      { key: "time",         label: "שעת התחלה" },
      { key: "staff",        label: "שם הספר" },
      { key: "address_line", label: "כתובת" },
    ],
  },
  swap_proposal: {
    label: "הצעת החלפת תור (ללקוח המועמד)",
    description: "נשלח ללקוח שאתה מציע לו להחליף תור עם לקוח אחר.",
    field: "swapProposalTemplate" as const,
    default: DEFAULT_SWAP_PROPOSAL_TEMPLATE,
    variables: [
      { key: "name",           label: "שם הלקוח המועמד" },
      { key: "business",       label: "שם העסק" },
      { key: "current_date",   label: "תאריך התור הנוכחי שלו" },
      { key: "current_time",   label: "שעת התור הנוכחי שלו" },
      { key: "proposed_date",  label: "תאריך התור המוצע במקום" },
      { key: "proposed_time",  label: "שעת התור המוצע" },
      { key: "proposed_staff", label: "ספר של התור המוצע" },
    ],
  },
  move_proposal: {
    label: "הצעת מעבר לשעה ריקה (לא החלפה עם לקוח אחר)",
    description: "נשלח ללקוח כשאתה מציע לו לעבור לזמן פנוי אחר ביומן (לא דורש החלפה עם לקוח אחר).",
    field: "moveProposalTemplate" as const,
    default: DEFAULT_MOVE_PROPOSAL_TEMPLATE,
    variables: [
      { key: "name",           label: "שם הלקוח" },
      { key: "business",       label: "שם העסק" },
      { key: "current_date",   label: "תאריך התור הנוכחי שלו" },
      { key: "current_time",   label: "שעת התור הנוכחי שלו" },
      { key: "proposed_date",  label: "תאריך השעה הריקה" },
      { key: "proposed_time",  label: "שעה הריקה" },
      { key: "proposed_staff", label: "ספר של השעה הריקה" },
    ],
  },
  swap_confirmation: {
    label: "אישור החלפת תור",
    description: "נשלח לשני הלקוחות אחרי שאישרת את ההחלפה — כל אחד מקבל את הפרטים החדשים שלו.",
    field: "swapConfirmationTemplate" as const,
    default: DEFAULT_SWAP_CONFIRMATION_TEMPLATE,
    variables: [
      { key: "name",     label: "שם הלקוח" },
      { key: "business", label: "שם העסק" },
      { key: "date",     label: "תאריך החדש" },
      { key: "time",     label: "שעה החדשה" },
      { key: "staff",    label: "ספר חדש" },
      { key: "service",  label: "שם השירות" },
    ],
  },
  appointment_moved: {
    label: "עדכון על שינוי תור (גרירה)",
    description: "נשלח ללקוח כשגוררת את התור שלו לשעה/יום אחרים והסכמת לעדכן אותו.",
    field: "appointmentMovedTemplate" as const,
    default: DEFAULT_APPOINTMENT_MOVED_TEMPLATE,
    variables: [
      { key: "name",     label: "שם הלקוח" },
      { key: "business", label: "שם העסק" },
      { key: "date",     label: "תאריך החדש" },
      { key: "time",     label: "שעה החדשה" },
      { key: "staff",    label: "שם הספר" },
      { key: "service",  label: "שם השירות" },
    ],
  },
  delay_notification: {
    label: "עדכון עיכוב",
    description: "נשלח ללקוח כשהספר מתעכב ורוצה לעדכן אותו כמה דקות לפני.",
    field: "delayNotificationTemplate" as const,
    default: DEFAULT_DELAY_NOTIFICATION_TEMPLATE,
    variables: [
      { key: "name",          label: "שם הלקוח" },
      { key: "business",      label: "שם העסק" },
      { key: "time",          label: "שעת התור המקורית" },
      { key: "delay_minutes", label: "מספר דקות עיכוב" },
    ],
  },
} as const;

export type TemplateKey = keyof typeof TEMPLATE_DEFS;

// ── Renderer helpers — all accept an optional custom template ────────────────
// If `customTemplate` is null/undefined, the built-in default is used.

export function confirmationText(
  params: {
    customerName: string;
    businessName: string;
    staffName: string;
    serviceName: string;
    dateLabel: string;
    startTime: string;
    endTime: string;
    price: number;
    address?: string | null;
  },
  customTemplate?: string | null,
): string {
  const tmpl = customTemplate || DEFAULT_CONFIRMATION_TEMPLATE;
  return applyTemplate(tmpl, {
    name:         params.customerName,
    business:     params.businessName,
    date:         params.dateLabel,
    time:         params.startTime,
    end_time:     params.endTime,
    staff:        params.staffName,
    service:      params.serviceName,
    price:        String(params.price),
    address_line: params.address ? `\n📍 ${params.address}` : "",
  });
}

/**
 * Sent to candidate customer asking if they'd trade their slot for the
 * primary customer's slot. The customer is expected to reply "כן" or "לא"
 * (free-text — admin reads the reply and marks the response in the UI).
 */
export function swapProposalText(
  params: {
    candidateName: string;
    businessName: string;
    candidateDateLabel: string;
    candidateTime: string;
    primaryDateLabel: string;
    primaryTime: string;
    primaryStaffName: string;
  },
  customTemplate?: string | null,
): string {
  const tmpl = customTemplate || DEFAULT_SWAP_PROPOSAL_TEMPLATE;
  return applyTemplate(tmpl, {
    name:           params.candidateName,
    business:       params.businessName,
    current_date:   params.candidateDateLabel,
    current_time:   params.candidateTime,
    proposed_date:  params.primaryDateLabel,
    proposed_time:  params.primaryTime,
    proposed_staff: params.primaryStaffName,
  });
}

/**
 * Sent to a customer asking if they'd move their appointment to a free slot
 * (no other customer involved — the slot is empty in the schedule). Used
 * when the barber needs to free up a specific time and the admin offers
 * the customer one or more alternative times.
 */
export function moveProposalText(
  params: {
    customerName: string;
    businessName: string;
    currentDateLabel: string;
    currentTime: string;
    proposedDateLabel: string;
    proposedTime: string;
    proposedStaffName: string;
  },
  customTemplate?: string | null,
): string {
  const tmpl = customTemplate || DEFAULT_MOVE_PROPOSAL_TEMPLATE;
  return applyTemplate(tmpl, {
    name:           params.customerName,
    business:       params.businessName,
    current_date:   params.currentDateLabel,
    current_time:   params.currentTime,
    proposed_date:  params.proposedDateLabel,
    proposed_time:  params.proposedTime,
    proposed_staff: params.proposedStaffName,
  });
}

/**
 * Sent to BOTH customers when admin approves the swap.
 * Confirms each customer's NEW slot details.
 */
export function swapConfirmationText(
  params: {
    customerName: string;
    businessName: string;
    newDateLabel: string;
    newTime: string;
    newStaffName: string;
    serviceName: string;
  },
  customTemplate?: string | null,
): string {
  const tmpl = customTemplate || DEFAULT_SWAP_CONFIRMATION_TEMPLATE;
  return applyTemplate(tmpl, {
    name:     params.customerName,
    business: params.businessName,
    date:     params.newDateLabel,
    time:     params.newTime,
    staff:    params.newStaffName,
    service:  params.serviceName,
  });
}

/**
 * Sent to a customer when admin moves their appointment to a new slot
 * (via drag-to-move) and chooses to notify them.
 */
export function appointmentMovedText(
  params: {
    customerName: string;
    businessName: string;
    newDateLabel: string;
    newTime: string;
    newStaffName: string;
    serviceName: string;
  },
  customTemplate?: string | null,
): string {
  const tmpl = customTemplate || DEFAULT_APPOINTMENT_MOVED_TEMPLATE;
  return applyTemplate(tmpl, {
    name:     params.customerName,
    business: params.businessName,
    date:     params.newDateLabel,
    time:     params.newTime,
    staff:    params.newStaffName,
    service:  params.serviceName,
  });
}

/**
 * Sent to a customer when the barber is running late and the admin
 * wants to let them know how many minutes the delay will be.
 */
export function delayNotificationText(
  params: {
    customerName: string;
    businessName: string;
    appointmentTime: string;
    delayMinutes: number;
  },
  customTemplate?: string | null,
): string {
  const tmpl = customTemplate || DEFAULT_DELAY_NOTIFICATION_TEMPLATE;
  return applyTemplate(tmpl, {
    name:          params.customerName,
    business:      params.businessName,
    time:          params.appointmentTime,
    delay_minutes: String(params.delayMinutes),
  });
}
