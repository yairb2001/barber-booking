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
}
