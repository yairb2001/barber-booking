// ── Types shared across messaging providers ──────────────────────────────────

export type MessageKind =
  | "confirmation"
  | "reminder_24h"
  | "otp"
  | "broadcast"
  | "manual"
  | "agent_reply";

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
