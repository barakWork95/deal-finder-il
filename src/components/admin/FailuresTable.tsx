"use client";

import { useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";
import type { DeliveryFailure } from "@/lib/admin-repository";
import { retryDeliveryAction } from "@/app/actions/admin";
import { formatWhen, Mono, Pill, TableWrap } from "@/components/admin/ui";

/**
 * Failed deliveries, with the one button that used to be a psql session.
 *
 * The worker will not retry a failure it marked non-retryable — a rejected key
 * or a bad address fails identically every run, and repeating it only burns the
 * attempt budget. So after fixing the cause, the ledger row has to be cleared
 * for the tender to go out. "שלח שוב" does exactly that and nothing else: the
 * next scheduled run decides whether to send, this only stops the ledger from
 * saying it already did.
 */
export function FailuresTable({ failures }: { failures: DeliveryFailure[] }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  if (failures.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border bg-surface-2 px-3 py-4 text-center text-xs text-muted">
        אין שליחות שנכשלו. 🎉
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <p className="rounded-lg border border-negative/40 bg-negative-soft px-3 py-2 text-xs text-negative">
          {error === "not_failed"
            ? "השורה כבר לא במצב ״נכשל״ — ייתכן שריצה אחרת טיפלה בה."
            : `הפעולה נכשלה (${error}).`}
        </p>
      )}

      <TableWrap>
        <table className="w-full min-w-[760px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-[11px] text-muted">
              <th className="p-2 text-start font-medium">התראה</th>
              <th className="p-2 text-start font-medium">מכרז</th>
              <th className="p-2 text-start font-medium">ערוץ</th>
              <th className="p-2 text-start font-medium">שגיאה</th>
              <th className="p-2 text-start font-medium">נוסה</th>
              <th className="p-2 text-end font-medium"> </th>
            </tr>
          </thead>
          <tbody>
            {failures.map((failure) => {
              const key = `${failure.alertId}:${failure.dealId}:${failure.channel}:${failure.reason}`;
              return (
                <tr key={key} className="border-b border-border/60 align-top">
                  <td className="p-2">
                    <div className="font-medium text-primary">{failure.alertName}</div>
                    <Mono title={failure.clerkUserId}>{failure.clerkUserId.slice(0, 18)}…</Mono>
                  </td>
                  <td className="p-2">
                    <Mono>{failure.dealId}</Mono>
                  </td>
                  <td className="p-2">
                    <div className="flex flex-col items-start gap-1">
                      <Pill tone={failure.channel === "whatsapp" ? "positive" : "accent"}>
                        {failure.channel === "whatsapp" ? "WhatsApp" : "Email"}
                      </Pill>
                      {failure.reason === "opening" && <Pill tone="warning">נפתח להגשה</Pill>}
                    </div>
                  </td>
                  <td className="max-w-[280px] p-2">
                    <span className="text-[11px] break-words text-negative" dir="ltr">
                      {failure.error ?? "—"}
                    </span>
                    {!failure.retryable && (
                      <div className="mt-1">
                        <Pill tone="negative">לא יינסה שוב אוטומטית</Pill>
                      </div>
                    )}
                  </td>
                  <td className="p-2 text-[11px] text-muted">
                    <span className="num">{failure.attempts}</span> · {formatWhen(failure.queuedAt)}
                  </td>
                  <td className="p-2 text-end">
                    <button
                      type="button"
                      disabled={busy === key}
                      onClick={() => {
                        setBusy(key);
                        setError(null);
                        startTransition(async () => {
                          const result = await retryDeliveryAction({
                            alertId: failure.alertId,
                            dealId: failure.dealId,
                            channel: failure.channel,
                            reason: failure.reason,
                          }).catch(() => ({ ok: false as const, reason: "network" }));
                          if (!result.ok) setError(result.reason);
                          setBusy(null);
                        });
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold text-muted transition hover:border-border-strong hover:text-primary disabled:opacity-50"
                    >
                      <RefreshCw size={13} />
                      {busy === key ? "…" : "שלח שוב"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableWrap>
    </div>
  );
}
