import { PersonalAreaRoute } from "@/components/personal/PersonalAreaRoute";

export const metadata = { title: "אזור אישי" };

// Saved deals are rendered from the live feed, so this must not be cached.
export const dynamic = "force-dynamic";

export default async function AlertsPage({ searchParams }: PageProps<"/alerts">) {
  return <PersonalAreaRoute params={await searchParams} defaultTab="alerts" />;
}
