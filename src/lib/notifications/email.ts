import "server-only";
import { emailConfig } from "./config";
import type { EmailMessage, SendOutcome } from "./types";

/**
 * Email transport (Resend).
 *
 * Called over plain fetch rather than through the `resend` SDK: the request is
 * one POST with a JSON body, and the repo's only backend dependency is
 * `postgres` — adding an SDK to save four lines is not worth the install.
 */

const ENDPOINT = "https://api.resend.com/emails";
const TIMEOUT_MS = 10_000;

export function isEmailConfigured(): boolean {
  return emailConfig() != null;
}

export async function sendEmail(message: EmailMessage): Promise<SendOutcome> {
  const config = emailConfig();
  if (!config) {
    return { status: "skipped", provider: "none", error: "email_not_configured" };
  }

  const headers: Record<string, string> = {};
  if (message.unsubscribeUrl) {
    // One-click unsubscribe. Gmail and Yahoo require this on bulk mail, and a
    // digest to every free user is bulk mail by their definition.
    headers["List-Unsubscribe"] = `<${message.unsubscribeUrl}>`;
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }

  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: config.from,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
        ...(config.replyTo ? { reply_to: config.replyTo } : {}),
        ...(Object.keys(headers).length ? { headers } : {}),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 300);
      return {
        status: "failed",
        provider: "resend",
        error: `resend_${response.status}: ${detail}`,
        // 4xx other than 429 means the message itself is wrong (bad address,
        // unverified domain) — retrying sends the same broken request again.
        retryable: response.status === 429 || response.status >= 500,
      };
    }

    const body = (await response.json().catch(() => ({}))) as { id?: string };
    return { status: "sent", provider: "resend", id: body.id };
  } catch (error) {
    return {
      status: "failed",
      provider: "resend",
      error: `resend_network: ${(error as Error).message}`.slice(0, 300),
      retryable: true,
    };
  }
}
