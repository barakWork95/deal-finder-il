"use client";

import { useState, useTransition } from "react";
import { BellOff, Crown, Search, Undo2, UserMinus } from "lucide-react";
import type { AdminUserRow } from "@/lib/admin-repository";
import { resubscribeContactAction, setUserTierAction } from "@/app/actions/admin";
import { IconInput } from "@/components/personal/controls";
import { formatWhen, Mono, Pill, TableWrap } from "@/components/admin/ui";

/**
 * The people table, and the one control that changes what the product does for
 * them: the PRO switch.
 *
 * There is no optimistic update here, unlike the personal area's panels. This
 * writes to *someone else's* account, and a plan that appears to flip and then
 * silently reverts is the kind of wrong that gets discovered by a user not
 * getting their alerts. The row waits for the server and re-renders from it.
 */

const SOURCE_LABEL: Record<string, string> = {
  default: "ברירת מחדל",
  admin: "נקבע ידנית",
  legacy_env: "מ-ENV (מיושן)",
  billing: "סליקה",
};

export function UsersTable({ users }: { users: AdminUserRow[] }) {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const needle = query.trim().toLowerCase();
  const visible = needle
    ? users.filter((user) =>
        [user.clerkUserId, user.email, user.phone].some((field) =>
          field?.toLowerCase().includes(needle),
        ),
      )
    : users;

  function run(key: string, action: () => Promise<{ ok: boolean; reason?: string }>) {
    setBusy(key);
    setError(null);
    startTransition(async () => {
      const result = await action().catch(() => ({ ok: false, reason: "network" }));
      if (!result.ok) setError(result.reason ?? "failed");
      setBusy(null);
    });
  }

  return (
    <div className="space-y-3">
      <IconInput
        icon={Search}
        dir="ltr"
        placeholder="חיפוש לפי מזהה, אימייל או טלפון"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />

      {error && (
        <p className="rounded-lg border border-negative/40 bg-negative-soft px-3 py-2 text-xs text-negative">
          הפעולה נכשלה ({error}). רענן ונסה שוב.
        </p>
      )}

      <TableWrap>
        <table className="w-full min-w-[820px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-[11px] text-muted">
              <th className="p-2 text-start font-medium">משתמש</th>
              <th className="p-2 text-start font-medium">מסלול</th>
              <th className="p-2 text-start font-medium">התראות</th>
              <th className="p-2 text-start font-medium">שמורות</th>
              <th className="p-2 text-start font-medium">נשלחו</th>
              <th className="p-2 text-start font-medium">סיכום אחרון</th>
              <th className="p-2 text-end font-medium">פעולות</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((user) => {
              const pro = user.tier === "pro";
              const tierKey = `tier:${user.clerkUserId}`;
              return (
                <tr key={user.clerkUserId} className="border-b border-border/60 align-top">
                  <td className="p-2">
                    <div className="flex flex-col gap-0.5">
                      <Mono title={user.clerkUserId}>
                        {user.email ?? user.clerkUserId.slice(0, 18)}
                      </Mono>
                      {user.email && <Mono title={user.clerkUserId}>{user.clerkUserId.slice(0, 18)}…</Mono>}
                      {user.phone && <Mono>{user.phone}</Mono>}
                      {user.unsubscribed && (
                        <span className="mt-1">
                          <Pill tone="negative">
                            <BellOff size={11} /> הסיר הרשמה
                          </Pill>
                        </span>
                      )}
                    </div>
                  </td>

                  <td className="p-2">
                    <div className="flex flex-col items-start gap-1">
                      <Pill tone={pro ? "accent" : "muted"}>
                        {pro && <Crown size={11} />} {pro ? "PRO" : "חינם"}
                      </Pill>
                      <span className="text-[10px] text-faint">
                        {SOURCE_LABEL[user.tierSource] ?? user.tierSource}
                        {user.tierUpdatedAt ? ` · ${formatWhen(user.tierUpdatedAt)}` : ""}
                      </span>
                      {user.tierNote && (
                        <span className="text-[10px] text-muted">{user.tierNote}</span>
                      )}
                    </div>
                  </td>

                  <td className="num p-2 text-primary">
                    {user.activeAlerts}
                    <span className="text-faint">/{user.alerts}</span>
                  </td>
                  <td className="num p-2 text-primary">{user.saved}</td>
                  <td className="num p-2 text-primary">{user.sent}</td>
                  <td className="p-2 text-[11px] text-muted">{formatWhen(user.lastDigestAt)}</td>

                  <td className="p-2">
                    <div className="flex flex-wrap items-center justify-end gap-1.5">
                      <button
                        type="button"
                        disabled={busy === tierKey}
                        onClick={() =>
                          run(tierKey, () =>
                            setUserTierAction({
                              clerkUserId: user.clerkUserId,
                              tier: pro ? "free" : "pro",
                              note: pro ? "הורד ידנית מלוח הבקרה" : "שודרג ידנית מלוח הבקרה",
                            }),
                          )
                        }
                        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition disabled:opacity-50 ${
                          pro
                            ? "border-border text-muted hover:border-negative hover:text-negative"
                            : "border-accent bg-accent-soft text-accent hover:brightness-105"
                        }`}
                      >
                        {pro ? <UserMinus size={13} /> : <Crown size={13} />}
                        {busy === tierKey ? "…" : pro ? "החזר לחינם" : "שדרג ל-PRO"}
                      </button>

                      {user.unsubscribed && (
                        <button
                          type="button"
                          disabled={busy === `sub:${user.clerkUserId}`}
                          onClick={() =>
                            run(`sub:${user.clerkUserId}`, () =>
                              resubscribeContactAction(user.clerkUserId),
                            )
                          }
                          title="רק לבקשת המשתמש"
                          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold text-muted transition hover:text-primary disabled:opacity-50"
                        >
                          <Undo2 size={13} /> שחזר הרשמה
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableWrap>

      {visible.length === 0 && (
        <p className="rounded-lg border border-dashed border-border bg-surface-2 px-3 py-4 text-center text-xs text-muted">
          {users.length === 0 ? "אין עדיין משתמשים רשומים." : "אין תוצאות לחיפוש הזה."}
        </p>
      )}
    </div>
  );
}
