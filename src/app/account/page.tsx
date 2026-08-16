import { PersonalAreaRoute } from "@/components/personal/PersonalAreaRoute";

export const metadata = { title: "פרטי חשבון" };

export const dynamic = "force-dynamic";

/**
 * The account tab as its own URL, so Clerk's "נהל חשבון" can send people to our
 * own screen instead of its modal — and so the address bar matches what the
 * menu item promised.
 */
export default async function AccountPage({ searchParams }: PageProps<"/account">) {
  return <PersonalAreaRoute params={await searchParams} defaultTab="account" />;
}
