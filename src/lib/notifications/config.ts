import "server-only";

/**
 * Every knob the notification engine reads from the environment, in one place.
 *
 * The rule this file exists to enforce: **missing configuration degrades, it
 * never throws.** The app already works this way for the database (no
 * DATABASE_URL → mock data) and for auth (no Clerk key → sign-in is simply
 * off). A half-configured notification stack must behave the same, otherwise
 * a forgotten env var on a preview deploy turns into a 500 on a cron route.
 *
 * Nothing here is NEXT_PUBLIC_: these are secrets and must never reach the
 * client bundle. That is also why the module is server-only.
 */

const str = (name: string): string | undefined => {
  const value = process.env[name];
  return value && value.trim() !== "" ? value.trim() : undefined;
};

const int = (name: string, fallback: number): number => {
  const raw = str(name);
  const parsed = raw == null ? NaN : Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const bool = (name: string, fallback: boolean): boolean => {
  const raw = str(name)?.toLowerCase();
  if (raw == null) return fallback;
  return raw === "1" || raw === "true" || raw === "yes";
};

// ── Email (Resend) ─────────────────────────────────────────
export type EmailConfig = {
  apiKey: string;
  from: string;
  replyTo?: string;
};

export function emailConfig(): EmailConfig | null {
  const apiKey = str("RESEND_API_KEY");
  const from = str("NOTIFY_EMAIL_FROM");
  if (!apiKey || !from) return null;
  return { apiKey, from, replyTo: str("NOTIFY_EMAIL_REPLY_TO") };
}

// ── WhatsApp (Twilio or Green API) ─────────────────────────
export type WhatsAppConfig =
  | {
      provider: "twilio";
      accountSid: string;
      authToken: string;
      from: string; // E.164 of the WhatsApp sender
      /**
       * Twilio requires an approved template (Content SID) for any message
       * that starts a conversation — which is every alert we send. Freeform
       * Body only works inside the 24h window or in the sandbox, so leaving
       * this unset is a development-only setup.
       */
      contentSid?: string;
    }
  | {
      provider: "green";
      instanceId: string;
      token: string;
      apiUrl: string;
    };

export function whatsappConfig(): WhatsAppConfig | null {
  const provider = str("WHATSAPP_PROVIDER")?.toLowerCase();

  if (provider === "twilio") {
    const accountSid = str("TWILIO_ACCOUNT_SID");
    const authToken = str("TWILIO_AUTH_TOKEN");
    const from = str("TWILIO_WHATSAPP_FROM");
    if (!accountSid || !authToken || !from) return null;
    return {
      provider: "twilio",
      accountSid,
      authToken,
      from,
      contentSid: str("TWILIO_WHATSAPP_CONTENT_SID"),
    };
  }

  if (provider === "green") {
    const instanceId = str("GREEN_API_INSTANCE_ID");
    const token = str("GREEN_API_TOKEN");
    if (!instanceId || !token) return null;
    return {
      provider: "green",
      instanceId,
      token,
      apiUrl: str("GREEN_API_URL") ?? "https://api.green-api.com",
    };
  }

  return null;
}

// ── Worker behaviour ───────────────────────────────────────
export const notificationSettings = {
  /** Master switch. Off → the worker still matches, but sends nothing. */
  get enabled() {
    return bool("NOTIFICATIONS_ENABLED", false);
  },
  /** How far back an "instant" run looks for newly ingested tenders. */
  get instantLookbackHours() {
    return int("NOTIFY_INSTANT_LOOKBACK_HOURS", 26);
  },
  /** How far back a digest run looks. Wider, so a missed day still lands. */
  get digestLookbackHours() {
    return int("NOTIFY_DIGEST_LOOKBACK_HOURS", 72);
  },
  /**
   * The free tier's headline limitation: tenders reach free users on a delay.
   * This is the product's main conversion lever, so it lives in config rather
   * than being hard-coded.
   */
  get freeDelayHours() {
    return int("NOTIFY_FREE_DELAY_HOURS", 24);
  },
  /**
   * How far ahead of a tender opening to send the "it opens soon" message.
   * 36h so a morning run reaches someone the day before, without firing so
   * early that "נפתח להגשה" is untrue for days.
   */
  get openingLeadHours() {
    return int("NOTIFY_OPENING_LEAD_HOURS", 36);
  },
  /** Most tenders in one message before it becomes "ועוד N". */
  get maxItemsPerMessage() {
    return int("NOTIFY_MAX_ITEMS_PER_MESSAGE", 5);
  },
  /** Safety valve: the most sends one invocation will attempt. */
  get maxSendsPerRun() {
    return int("NOTIFY_MAX_SENDS_PER_RUN", 200);
  },
  /** A failed delivery is retried by later runs up to this many attempts. */
  get maxAttempts() {
    return int("NOTIFY_MAX_ATTEMPTS", 3);
  },
  /** Public origin used for links inside messages. */
  get siteUrl() {
    return (
      str("NEXT_PUBLIC_SITE_URL") ??
      (str("VERCEL_PROJECT_PRODUCTION_URL") && `https://${str("VERCEL_PROJECT_PRODUCTION_URL")}`) ??
      "https://deal-finder-il.vercel.app"
    );
  },
  /**
   * Clerk ids granted PRO by hand, comma-separated. Billing is not live yet,
   * so this is how the instant path gets exercised at all.
   */
  get proUserIds(): string[] {
    return (str("NOTIFY_PRO_USER_IDS") ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
  },
  get cronSecret() {
    return str("CRON_SECRET");
  },
};

/**
 * Which variables a channel is still waiting on.
 *
 * Names only — never values. "not_configured" on its own turns setup into a
 * guessing game across a dozen variables and a redeploy per guess, and the
 * name of a variable you already know you set is not a secret. The one value
 * echoed back is WHATSAPP_PROVIDER, because "you typed Green API, this wants
 * green" is the whole answer and that value is a fixed keyword, not a
 * credential.
 */
function missingVars(): string[] {
  const missing: string[] = [];

  if (!notificationSettings.enabled) missing.push("NOTIFICATIONS_ENABLED (must be true/1)");
  if (!str("RESEND_API_KEY")) missing.push("RESEND_API_KEY");
  if (!str("NOTIFY_EMAIL_FROM")) missing.push("NOTIFY_EMAIL_FROM");

  const provider = str("WHATSAPP_PROVIDER")?.toLowerCase();
  if (!provider) {
    missing.push('WHATSAPP_PROVIDER (set to "green" or "twilio")');
  } else if (provider === "green") {
    if (!str("GREEN_API_INSTANCE_ID")) missing.push("GREEN_API_INSTANCE_ID");
    if (!str("GREEN_API_TOKEN")) missing.push("GREEN_API_TOKEN");
  } else if (provider === "twilio") {
    if (!str("TWILIO_ACCOUNT_SID")) missing.push("TWILIO_ACCOUNT_SID");
    if (!str("TWILIO_AUTH_TOKEN")) missing.push("TWILIO_AUTH_TOKEN");
    if (!str("TWILIO_WHATSAPP_FROM")) missing.push("TWILIO_WHATSAPP_FROM");
  } else {
    missing.push(`WHATSAPP_PROVIDER is "${provider}" — expected "green" or "twilio"`);
  }

  if (!str("CRON_SECRET")) missing.push("CRON_SECRET");
  return missing;
}

/** Summary for the health endpoint and the run log — never includes secrets. */
export function notificationStatus() {
  const email = emailConfig();
  const whatsapp = whatsappConfig();
  return {
    enabled: notificationSettings.enabled,
    email: email ? "resend" : "not_configured",
    /**
     * The sender address, echoed back. It is not a secret — it rides in the
     * headers of every message we send — and without it the only way to tell
     * whether a NOTIFY_EMAIL_FROM change reached the running build is to
     * attempt a send and read the failure. That cost three redeploys and three
     * manual ledger deletions when Resend rejected an unverified domain.
     */
    emailFrom: email?.from ?? null,
    whatsapp: whatsapp ? whatsapp.provider : "not_configured",
    /** With nothing configured, every run is a dry run whether asked or not. */
    canSend: notificationSettings.enabled && Boolean(email || whatsapp),
    /** Exactly what is still needed, so setup is not a guess-and-redeploy loop. */
    missing: missingVars(),
    /**
     * Which commit answered. Env changes only reach a *new* deployment, so
     * "I set it and it still says missing" is usually "the old build replied".
     */
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local",
  };
}
