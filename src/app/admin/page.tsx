import { notFound } from "next/navigation";
import { currentAdminId, isDevOpenAccess } from "@/lib/admin";
import { getAdminSnapshot } from "@/lib/admin-repository";
import { notificationStatus } from "@/lib/notifications/config";
import { AdminDashboard } from "@/components/admin/AdminDashboard";

export const metadata = {
  title: "לוח בקרה",
  // Internal, and never worth an index entry even if the URL leaks.
  robots: { index: false, follow: false },
};

// Everything on this page is a live count. Caching it would mean a dashboard
// that reassures you with yesterday's numbers.
export const dynamic = "force-dynamic";

export default async function AdminPage() {
  // notFound(), not a 403: a page that answers "forbidden" confirms it exists,
  // and there is nothing to gain from telling a stranger where the admin
  // dashboard lives. To the rest of the world /admin is simply not a route.
  if (!(await currentAdminId())) notFound();

  const snapshot = await getAdminSnapshot();
  const status = notificationStatus();

  return (
    <AdminDashboard
      snapshot={snapshot}
      health={{
        enabled: status.enabled,
        canSend: status.canSend,
        email: status.email,
        emailFrom: status.emailFrom,
        whatsapp: status.whatsapp,
        missing: status.missing,
        commit: status.commit,
      }}
      devOpen={isDevOpenAccess()}
    />
  );
}
