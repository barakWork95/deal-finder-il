import { notFound } from "next/navigation";
import { getDealById } from "@/lib/repository";
import { currentTier } from "@/lib/plan";
import { DealDetailBody, DealActions } from "@/components/DealDetailBody";
import { DealDrawer } from "@/components/DealDrawer";

/**
 * A click on the feed opens the tender here, over the feed, instead of
 * navigating away from it. A hard load or a shared link still gets the full
 * page at src/app/deal/[id]/page.tsx — this only intercepts navigation that
 * starts on the feed, so the URL is the same either way and nothing about the
 * deep view is reachable only through JavaScript.
 *
 * Deliberately a server component that hands DealDrawer its children. The
 * drawer is the client half and never receives the deal, so the tier decision
 * inside WinningPremium keeps happening where it cannot be inspected — the
 * same reason src/app/page.tsx strips those fields before they reach the feed.
 */
export const dynamic = "force-dynamic";

export default async function InterceptedDealPage({ params }: PageProps<"/deal/[id]">) {
  const { id } = await params;
  const deal = await getDealById(id);
  if (!deal) notFound();

  // Sequential, never alongside the query above — one request holding two
  // pooled connections at once is how this app deadlocked its pool before.
  const tier = await currentTier();

  return (
    <DealDrawer fullHref={`/deal/${deal.id}`} title={`${deal.propertyType} · ${deal.city}`}>
      <div className="mb-4 flex flex-wrap items-center justify-end gap-y-2">
        <DealActions deal={deal} />
      </div>
      <DealDetailBody deal={deal} tier={tier} layout="drawer" />
    </DealDrawer>
  );
}
