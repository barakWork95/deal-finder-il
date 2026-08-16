import { auth } from "@clerk/nextjs/server";
import { listDeals, listCities } from "@/lib/repository";
import { isAuthConfigured } from "@/lib/auth";
import { getUserData } from "@/lib/user-repository";
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

  return (
    <PersonalArea
      deals={deals}
      cities={cities}
      initialTab={parseTab(Array.isArray(params.tab) ? params.tab[0] : params.tab, defaultTab)}
      prefill={parseAlertPrefill(params)}
      account={account}
    />
  );
}
