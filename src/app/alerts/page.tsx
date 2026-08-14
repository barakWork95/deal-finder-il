import { auth } from "@clerk/nextjs/server";
import { listDeals, listCities } from "@/lib/repository";
import { isAuthConfigured } from "@/lib/auth";
import { getUserData } from "@/lib/user-repository";
import { PersonalArea } from "@/components/personal/PersonalArea";
import { parseAlertPrefill, parseTab } from "@/lib/alert-prefill";

export const metadata = { title: "אזור אישי" };

// Saved deals are rendered from the live feed, so this must not be cached.
export const dynamic = "force-dynamic";

/**
 * The tab and any carried-over feed filters are read here rather than through
 * useSearchParams, so a deep link like /alerts?tab=billing renders on the
 * right tab server-side instead of flashing the default one first.
 */
export default async function PersonalAreaPage({ searchParams }: PageProps<"/alerts">) {
  const params = await searchParams;
  const [deals, cities] = await Promise.all([listDeals(), listCities()]);

  // Signed in: the account's rows are rendered on the server, so the panels
  // arrive populated instead of flashing empty while a client fetch lands.
  const userId = isAuthConfigured() ? (await auth()).userId : null;
  const account = userId ? await getUserData(userId) : undefined;

  return (
    <PersonalArea
      deals={deals}
      cities={cities}
      initialTab={parseTab(Array.isArray(params.tab) ? params.tab[0] : params.tab)}
      prefill={parseAlertPrefill(params)}
      account={account}
    />
  );
}
