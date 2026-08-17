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

/** Summary for the health endpoint and the run log — never includes secrets. */
export function notificationStatus() {
  const email = emailConfig();
  const whatsapp = whatsappConfig();
  return {
    enabled: notificationSettings.enabled,
    email: email ? "resend" : "not_configured",
    whatsapp: whatsapp ? whatsapp.provider : "not_configured",
    /** With nothing configured, every run is a dry run whether asked or not. */
    canSend: notificationSettings.enabled && Boolean(email || whatsapp),
  };
}
