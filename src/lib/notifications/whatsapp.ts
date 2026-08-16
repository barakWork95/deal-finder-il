import "server-only";
import { whatsappConfig } from "./config";
import type { SendOutcome, WhatsAppMessage } from "./types";

/**
 * WhatsApp transport, behind one function with two providers.
 *
 *   twilio — the official Business API. Correct and auditable, but any message
 *            that *starts* a conversation (every alert we send) needs a
 *            pre-approved template, referenced by Content SID. Freeform text
 *            only reaches someone who messaged us in the last 24h, or the
 *            sandbox number.
 *   green  — Green API, which drives a real WhatsApp account. No template
 *            approval, no waiting for Meta — which is why it is the practical
 *            choice for getting the channel working this month. It is
 *            unofficial: treat it as the staging/bootstrap provider.
 *
 * Switching is one env var (WHATSAPP_PROVIDER), so the worker never learns
 * which one is live.
 */

const TIMEOUT_MS = 10_000;

export function isWhatsAppConfigured(): boolean {
  return whatsappConfig() != null;
}

export function whatsappProviderName(): string {
  return whatsappConfig()?.provider ?? "none";
}

export async function sendWhatsApp(message: WhatsAppMessage): Promise<SendOutcome> {
  const config = whatsappConfig();
  if (!config) {
    return { status: "skipped", provider: "none", error: "whatsapp_not_configured" };
  }
  if (!message.to.startsWith("+")) {
    return { status: "skipped", provider: config.provider, error: "phone_not_e164" };
  }

  return config.provider === "twilio" ? sendViaTwilio(config, message) : sendViaGreen(config, message);
}

// ── Twilio ─────────────────────────────────────────────────
type TwilioConfig = Extract<NonNullable<ReturnType<typeof whatsappConfig>>, { provider: "twilio" }>;

async function sendViaTwilio(config: TwilioConfig, message: WhatsAppMessage): Promise<SendOutcome> {
  const form = new URLSearchParams({
    To: `whatsapp:${message.to}`,
    From: `whatsapp:${config.from}`,
  });

  if (config.contentSid) {
    form.set("ContentSid", config.contentSid);
    if (message.templateVariables) {
      form.set("ContentVariables", JSON.stringify(message.templateVariables));
    }
  } else {
    form.set("Body", message.body);
  }

  try {
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${btoa(`${config.accountSid}:${config.authToken}`)}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form.toString(),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );

    const body = (await response.json().catch(() => ({}))) as {
      sid?: string;
      message?: string;
      code?: number;
    };

    if (!response.ok) {
      return {
        status: "failed",
        provider: "twilio",
        error: `twilio_${response.status}_${body.code ?? ""}: ${body.message ?? ""}`.slice(0, 300),
        retryable: response.status === 429 || response.status >= 500,
      };
    }

    return { status: "sent", provider: "twilio", id: body.sid };
  } catch (error) {
    return {
      status: "failed",
      provider: "twilio",
      error: `twilio_network: ${(error as Error).message}`.slice(0, 300),
      retryable: true,
    };
  }
}

// ── Green API ──────────────────────────────────────────────
type GreenConfig = Extract<NonNullable<ReturnType<typeof whatsappConfig>>, { provider: "green" }>;

async function sendViaGreen(config: GreenConfig, message: WhatsAppMessage): Promise<SendOutcome> {
  // Green addresses chats as <international digits>@c.us — no plus sign.
  const chatId = `${message.to.replace(/^\+/, "")}@c.us`;

  try {
    const response = await fetch(
      `${config.apiUrl}/waInstance${config.instanceId}/sendMessage/${config.token}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId, message: message.body }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );

    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 300);
      return {
        status: "failed",
        provider: "green",
        error: `green_${response.status}: ${detail}`,
        retryable: response.status === 429 || response.status >= 500,
      };
    }

    const body = (await response.json().catch(() => ({}))) as { idMessage?: string };
    return { status: "sent", provider: "green", id: body.idMessage };
  } catch (error) {
    return {
      status: "failed",
      provider: "green",
      error: `green_network: ${(error as Error).message}`.slice(0, 300),
      retryable: true,
    };
  }
}
