// ── Types shared across messaging providers ──────────────────────────────────

export type MessageKind =
  | "confirmation"
  | "reminder_24h"
  | "reminder_2h"
  | "waitlist_notify"
  | "otp"
  | "broadcast"
  | "manual"
  | "agent_reply"
  | "reengage"
  | "post_first_visit"
  | "post_every_visit"
  // Swap-flow messages
  | "swap_proposal"      // sent to candidate customers asking if they'd trade
  | "move_proposal"      // sent to a customer asking if they'd move to a free slot
  | "swap_confirmation"  // sent to both customers when admin approves the swap
  | "swap_cancelled"     // sent when a proposal is cancelled
  // Drag-to-move follow-up
  | "appointment_moved"  // sent to a customer when their appointment is moved by admin
  // Delay notifications
  | "delay_notification" // sent to a customer when the barber is running late
  // Appointment cancelled by the business
  | "appointment_cancelled" // sent to a customer when staff cancels their appointment
  // First-time customer booking — replaces the regular confirmation
  | "first_booking"
  // Walk-in customers — thank-you + booking link after appointment ends
  | "walk_in"
  // Referral thank-you — sent to the friend who referred a new customer
  | "referral_thankyou"
  // Internal business reports (sent to manager/staff, not customers)
  | "report_daily"
  | "report_weekly"
  | "report_monthly"
  // Internal staff summaries
  | "barber_daily_summary";

export type MessageStatus =
  | "queued"
  | "sent"
  | "delivered"
  | "read"
  | "failed";

export type SendResult = {
  ok: boolean;
  providerId?: string;
  error?: string;
};

export type ProviderConfig = {
  whatsappNumber?: string | null;
  greenApiInstanceId?: string | null;
  greenApiToken?: string | null;
};

export interface MessagingProvider {
  /** Returns true when this provider is correctly configured and can send. */
  isConfigured(): boolean;
  /** Send a plain WhatsApp text message to a phone (E.164 or local). */
  sendText(phone: string, body: string): Promise<SendResult>;
}
