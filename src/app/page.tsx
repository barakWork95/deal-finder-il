import { listDeals, listCities } from "@/lib/repository";
import { DealFeed } from "@/components/DealFeed";

// Always read fresh from the DB in dev; deals change frequently in production.
export const dynamic = "force-dynamic";

export default async function DealFeedPage() {
  const [deals, cities] = await Promise.all([listDeals(), listCities()]);
  return <DealFeed deals={deals} cities={cities} />;
}
