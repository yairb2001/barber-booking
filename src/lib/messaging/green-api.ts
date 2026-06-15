import type { MessagingProvider, ProviderConfig, SendResult } from "./types";
import { toGreenChatId } from "./phone";

/**
 * Green API provider.
 * Docs: https://green-api.com/en/docs/api/sending/SendMessage/
 * Endpoint: https://api.green-api.com/waInstance{instanceId}/sendMessage/{token}
 */
export class GreenApiProvider implements MessagingProvider {
  private instanceId: string;
  private token: string;

  constructor(config: ProviderConfig) {
    this.instanceId = config.greenApiInstanceId || "";
    this.token = config.greenApiToken || "";
  }

  isConfigured(): boolean {
    return !!(this.instanceId && this.token);
  }

  async sendText(phone: string, body: string): Promise<SendResult> {
    if (!this.isConfigured()) {
      return { ok: false, error: "Green API not configured" };
    }

    const chatId = toGreenChatId(phone);
    const url = `https://api.green-api.com/waInstance${this.instanceId}/sendMessage/${this.token}`;

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId, message: body }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return { ok: false, error: `Green API HTTP ${res.status}: ${text.slice(0, 200)}` };
      }

      const data = (await res.json()) as { idMessage?: string };
      return { ok: true, providerId: data.idMessage };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Network error" };
    }
  }

  /**
   * Read the instance authorization state.
   * Returns one of: authorized | notAuthorized | starting | yellowCard | blocked.
   * Docs: https://green-api.com/en/docs/api/account/GetStateInstance/
   */
  async getState(): Promise<{ ok: boolean; state?: string; error?: string }> {
    if (!this.isConfigured()) return { ok: false, error: "not_configured" };
    const url = `https://api.green-api.com/waInstance${this.instanceId}/getStateInstance/${this.token}`;
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
      }
      const data = (await res.json()) as { stateInstance?: string };
      return { ok: true, state: data.stateInstance };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Network error" };
    }
  }

  /**
   * Fetch the WhatsApp linking QR for re-authorizing the instance.
   * The QR rotates every ~20s, so the caller should poll.
   *   type "qrCode"       → `qr` is a data-URI PNG ready for an <img src>.
   *   type "alreadyLogged"→ already authorized, no QR needed.
   *   type "error"        → message holds the reason.
   * Docs: https://green-api.com/en/docs/api/account/QR/
   */
  async getQr(): Promise<{ ok: boolean; type?: string; qr?: string; message?: string; error?: string }> {
    if (!this.isConfigured()) return { ok: false, error: "not_configured" };
    const url = `https://api.green-api.com/waInstance${this.instanceId}/qr/${this.token}`;
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
      }
      const data = (await res.json()) as { type?: string; message?: string };
      const qr = data.type === "qrCode" && data.message
        ? `data:image/png;base64,${data.message}`
        : undefined;
      return { ok: true, type: data.type, qr, message: data.message };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Network error" };
    }
  }
}
