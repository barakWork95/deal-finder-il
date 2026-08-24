import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { getDealById } from "@/lib/repository";
import { currentTier } from "@/lib/plan";
import { DealDetailBody, DealActions } from "@/components/DealDetailBody";

/**
 * The full page for a tender: a shared link, a hard load, or "עמוד מלא" from
 * the drawer. A click that starts on the feed is intercepted before it gets
 * here and rendered in place — see src/app/@modal/(.)deal/[id]/page.tsx, which
 * fetches and gates exactly as this does.
 */
export default async function DealDetailPage({ params }: PageProps<"/deal/[id]">) {
  const { id } = await params;
  const deal = await getDealById(id);
  if (!deal) notFound();

  // Sequential, never alongside the query above — one request holding two
  // pooled connections at once is how this app deadlocked its pool before.
  const tier = await currentTier();

  return (
    <div className="mx-auto max-w-[1000px] px-4 py-5">
      {/* Back + actions */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-y-2">
        <Link href="/" className="flex items-center gap-1.5 text-sm text-muted transition hover:text-primary">
          <ArrowRight size={16} /> חזרה לפיד
        </Link>
        <DealActions deal={deal} />
      </div>

      <DealDetailBody deal={deal} tier={tier} layout="page" />
    </div>
  );
}
