import "server-only";
import { auth } from "@clerk/nextjs/server";
import { isAuthConfigured } from "./auth";

/**
 * Who may see the admin dashboard.
 *
 * A list of Clerk ids in ADMIN_USER_IDS, checked on the server on every entry
 * point. There is no admin flag in our database on purpose: a column granting
 * access to everyone else's data is one SQL injection or one careless UPDATE
 * away from being set, whereas an environment variable can only be changed by
 * someone who can already deploy.
 *
 * The dashboard reads other people's contact details and can hand out PRO, so
 * both the page and every action re-check independently — the page's guard
 * protects the page, not the mutations it renders.
 */

function adminUserIds(): string[] {
  return (process.env.ADMIN_USER_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

export function isAdminConfigured(): boolean {
  return adminUserIds().length > 0;
}

/**
 * With no list configured, local development is let in and production is not.
 *
 * Without this the dashboard would be unbuildable locally for anyone who has
 * not set up Clerk — and "no admins are configured" must never resolve to
 * "everyone is an admin" on a deployed site, which is why the check is on
 * NODE_ENV rather than on whether auth happens to be switched on.
 */
export function isDevOpenAccess(): boolean {
  return !isAdminConfigured() && process.env.NODE_ENV !== "production";
}

export function isAdminUserId(userId: string | null | undefined): boolean {
  if (isDevOpenAccess()) return true;
  return Boolean(userId) && adminUserIds().includes(userId as string);
}

/**
 * The signed-in admin's id, or null. Returns a stand-in id in the local
 * development case so the audit log still records who acted.
 */
export async function currentAdminId(): Promise<string | null> {
  if (!isAuthConfigured()) return isDevOpenAccess() ? "dev" : null;

  const { userId } = await auth();
  if (isAdminUserId(userId)) return userId ?? "dev";
  return null;
}
