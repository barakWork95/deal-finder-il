import { auth } from "@clerk/nextjs/server";
import { listDeals, listCities } from "@/lib/repository";
import { isAuthConfigured } from "@/lib/auth";
import { getUserData } from "@/lib/user-repository";
import { notificationStatus } from "@/lib/notifications/config";
import { paypalConfig, canCheckout } from "@/lib/billing/config";
import { isAdminUserId } from "@/lib/admin";
import { hasFeature } from "@/lib/limits";
import { listSubscriptionsForUser } from "@/lib/billing/repository";
import { PersonalArea } from "@/components/personal/PersonalArea";
import { parseAlertPrefill, parseTab, type PersonalTab } from "@/lib/alert-prefill";

type RawParams = Record<string, string | string[] | undefined>;

/**
 * Shared server half of the personal area, so /alerts and /account are the same
 * screen entered on a different tab rather than two implementations.
 *
 * `?tab=` still wins over the route's own default, which keeps every deep link
 * working from either entry point — and keeps the client's tab switching
 * (which rewrites the query on whatever path you are on) coherent.
 */
export async function PersonalAreaRoute({
  params,
  defaultTab,
}: {
  params: RawParams;
  defaultTab: PersonalTab;
}) {
  const [deals, cities] = await Promise.all([listDeals(), listCities()]);

  // Signed in: the account's rows are rendered on the server, so the panels
  // arrive populated instead of flashing empty while a client fetch lands.
  const userId = isAuthConfigured() ? (await auth()).userId : null;
  const account = userId ? await getUserData(userId) : undefined;

  // Sequential for the same reason as the line above — one request must never
  // hold two pooled connections at once.
  const subscriptions = userId ? await listSubscriptionsForUser(userId) : [];

  // Whether alerts actually get sent depends on server-side keys the browser
  // cannot see, so the answer is resolved here and passed down — the panel
  // must never claim a channel is live when nothing is configured behind it.
  // Whether checkout can be offered is a server-side question: it depends on a
  // secret and on a plan id the browser cannot see. The client id it returns is
  // public by design — it identifies the merchant, not the account.
  const paypal = paypalConfig();

  // Sandbox credentials on a production deployment are a real hazard, not just
  // an untidy state: the button renders and works, but only a PayPal *sandbox*
  // account can complete it. A visitor's real account simply cannot log in, so
  // everyone who tries is sent to a dead end. The "מצב בדיקה" notice keeps that
  // from being deceptive; it does not make it useful.
  //
  // So while sandbox is paired with production, checkout is offered to admins
  // only — enough to test the whole path on the real deployment, without
  // showing a payment button that nobody else can finish. Setting
  // PAYPAL_ENV=live removes the restriction on its own.
  const sandboxOnProd = paypal?.environment === "sandbox" && process.env.NODE_ENV === "production";
  const offerCheckout = canCheckout(paypal) && (!sandboxOnProd || isAdminUserId(userId));

  const billing =
    offerCheckout && paypal
      ? {
          configured: true,
          sandbox: paypal.environment === "sandbox",
          clientId: paypal.clientId,
          currency: paypal.currency,
          price: paypal.price,
        }
      : undefined;

  const tier = account?.tier ?? "free";

  // Stripped here, for the same reason as the feed's own strip in
  // src/app/page.tsx: PersonalArea is a client component, so every field it
  // receives is serialised into the page. SavedDealsPanel renders a PRO
  // affordance in place of the projection, and that gate is only real if the
  // number never reaches the browser — otherwise it sits in the RSC payload
  // for anyone who opens the network tab.
  //
  // winningPremiumN is deliberately left in: the sample size is public (see
  // WinningPremium), it is the free plan's basis-of-calculation, not the
  // projection itself.
  const visibleDeals = hasFeature(tier, "premium_calculator")
    ? deals
    : deals.map(({ winningPremium, expectedWinningPrice, expectedGapPct, ...rest }) => {
        void winningPremium;
        void expectedWinningPrice;
        void expectedGapPct;
        return rest;
      });

  const status = notificationStatus();
  const delivery = {
    email: status.canSend && status.email !== "not_configured",
    whatsapp: status.canSend && status.whatsapp !== "not_configured",
  };

  return (
    <PersonalArea
      deals={visibleDeals}
      cities={cities}
      initialTab={parseTab(Array.isArray(params.tab) ? params.tab[0] : params.tab, defaultTab)}
      prefill={parseAlertPrefill(params)}
      account={account}
      delivery={delivery}
      tier={tier}
      billing={billing}
      subscriptions={subscriptions.map((subscription) => ({
        id: subscription.id,
        status: subscription.status,
        currentPeriodEnd: subscription.currentPeriodEnd,
        cancelledAt: subscription.cancelledAt,
      }))}
    />
  );
}
