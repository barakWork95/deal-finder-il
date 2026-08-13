import { listDeals, listCities } from "@/lib/repository";
import { PersonalArea } from "@/components/personal/PersonalArea";

export const metadata = { title: "אזור אישי" };

// Saved deals are rendered from the live feed, so this must not be cached.
export const dynamic = "force-dynamic";

export default async function PersonalAreaPage() {
  const [deals, cities] = await Promise.all([listDeals(), listCities()]);
  return <PersonalArea deals={deals} cities={cities} />;
}
