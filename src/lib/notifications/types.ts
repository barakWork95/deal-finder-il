import type { AlertChannel } from "@/lib/types";

/**
 * The provider-facing contract. Email and WhatsApp are deliberately described
 * by the same result shape so the worker can treat a channel as a value and
 * write one ledger row per outcome, whatever sent it.
 */

export type SendStatus = "sent" | "failed" | "skipped";

export type SendOutcome = {
  status: SendStatus;
  /** "resend" | "twilio" | "green" | "none" — recorded on the delivery row. */
  provider: string;
  /** Provider-side message id, when the send succeeded. */
  id?: string;
  /** Why it failed or was skipped. Safe to store; never contains credentials. */
  error?: string;
  /** A later run may try again (rate limit, 5xx, network). */
  retryable?: boolean;
};

export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Feeds the List-Unsubscribe header — mailbox providers expect it. */
  unsubscribeUrl?: string;
};

export type WhatsAppMessage = {
  /** E.164, e.g. +972501234567. */
  to: string;
  body: string;
  /**
   * Variables for an approved template, positional as Twilio expects
   * ({"1": "...", "2": "..."}). Ignored by providers that send freeform text.
   */
  templateVariables?: Record<string, string>;
};

export type { AlertChannel };
