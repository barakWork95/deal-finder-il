import { listDeals, listCities } from "@/lib/repository";
import { currentTier } from "@/lib/plan";
import { hasFeature } from "@/lib/limits";
import { DealFeed } from "@/components/DealFeed";

// Always read fresh from the DB in dev; deals change frequently in production.
export const dynamic = "force-dynamic";

export default async function DealFeedPage() {
  const [deals, cities] = await Promise.all([listDeals(), listCities()]);
  // Sequential, after the pair above: one request must never hold two pooled
  // connections while waiting on a third (see src/lib/db.ts).
  const tier = await currentTier();

  // Stripped here, not hidden in the component. DealFeed is a client
  // component, so whatever it receives is serialised into the page — a value
  // merely styled as locked would still be readable by anyone who opens the
  // network tab, which would make the gate decorative. The tender page needs
  // no equivalent because WinningPremium renders on the server.
  const visible = hasFeature(tier, "premium_calculator")
    ? deals
    : deals.map(({ winningPremium, expectedWinningPrice, expectedGapPct, ...rest }) => {
        void winningPremium;
        void expectedWinningPrice;
        void expectedGapPct;
        return rest;
      });

  return <DealFeed deals={visible} cities={cities} tier={tier} />;
}
