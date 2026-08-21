import {
  Activity,
  AlertTriangle,
  BarChart3,
  Database,
  History,
  Mail,
  Send,
  ShieldCheck,
  Users,
} from "lucide-react";
import type { AdminSnapshot } from "@/lib/admin-repository";
import { EVENT_LABEL } from "@/lib/events";
import { UsersTable } from "@/components/admin/UsersTable";
import { FailuresTable } from "@/components/admin/FailuresTable";
import {
  Empty,
  formatWhen,
  MiniBars,
  Mono,
  Pill,
  Section,
  StatCard,
  TableWrap,
} from "@/components/admin/ui";

/**
 * The dashboard itself: one server render of everything worth knowing about
 * the product, in the order the questions actually get asked.
 *
 *   who is using it → is anyone trying to pay → did the alerts go out →
 *   is the pipeline still feeding it
 *
 * Deliberately one long page rather than tabs. It is read by one person, it is
 * read top to bottom, and every tab would be another click between a number and
 * the number that explains it.
 */

export type NotificationHealth = {
  enabled: boolean;
  canSend: boolean;
  email: string;
  emailFrom: string | null;
  whatsapp: string;
  missing: string[];
  commit: string;
};

export function AdminDashboard({
  snapshot,
  health,
  devOpen,
}: {
  snapshot: AdminSnapshot;
  health: NotificationHealth;
  devOpen: boolean;
}) {
  const { totals, deliveries, funnel, pipeline } = snapshot;

  return (
    <div className="mx-auto max-w-[1200px] space-y-4 px-4 py-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-primary">לוח בקרה</h1>
          <p className="mt-0.5 text-xs text-muted">
            נתוני מוצר, משתמשים ותשתית — לעיניים פנימיות בלבד.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Pill tone={health.canSend ? "positive" : "warning"}>
            <Send size={11} /> {health.canSend ? "שליחה פעילה" : "שליחה כבויה"}
          </Pill>
          <Pill tone="muted">
            <Mono>{health.commit}</Mono>
          </Pill>
        </div>
      </header>

      {devOpen && (
        <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning-soft p-3 text-xs text-warning">
          <ShieldCheck size={14} className="mt-px shrink-0" />
          <span>
            <b>ADMIN_USER_IDS לא מוגדר.</b> בסביבת פיתוח הדף פתוח; בפרודקשן הוא ייחסם לחלוטין עד
            שתגדירו את המשתנה. הוסיפו את מזהה ה-Clerk שלכם לפני העלייה.
          </span>
        </p>
      )}

      {!snapshot.hasDb && (
        <p className="flex items-start gap-2 rounded-lg border border-border bg-surface-2 p-3 text-xs text-muted">
          <Database size={14} className="mt-px shrink-0 text-accent" />
          <span>
            אין DATABASE_URL בסביבה הזו — האפליקציה רצה על נתוני דמו, ואין מה להציג כאן.
          </span>
        </p>
      )}

      {snapshot.hasDb && !snapshot.eventsReady && (
        <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning-soft p-3 text-xs text-warning">
          <AlertTriangle size={14} className="mt-px shrink-0" />
          <span>
            טבלת <Mono>app_events</Mono> לא קיימת בבסיס הנתונים הזה — הריצו את{" "}
            <Mono>db/017_admin.sql</Mono>. שאר הלוח עובד; רק מדדי המוצר ריקים.
          </span>
        </p>
      )}

      {/* ── The numbers ─────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="משתמשים" value={totals.users} sub={`${totals.pro} מתוכם PRO`} />
        <StatCard
          label="התראות פעילות"
          value={totals.activeAlerts}
          sub={`מתוך ${totals.alerts} שנוצרו`}
          tone="accent"
        />
        <StatCard label="עסקאות שמורות" value={totals.saved} />
        <StatCard
          label="מכרזים פעילים"
          value={pipeline.active}
          sub={`${pipeline.deals} סה״כ במאגר`}
        />
        <StatCard
          label="נשלחו (7 ימים)"
          value={deliveries.sent7d}
          sub={`אימייל ${deliveries.email7d} · וואטסאפ ${deliveries.whatsapp7d}`}
          tone="positive"
        />
        <StatCard
          label="נכשלו (7 ימים)"
          value={deliveries.failed7d}
          tone={deliveries.failed7d > 0 ? "negative" : "default"}
          sub={deliveries.queued > 0 ? `${deliveries.queued} תקועות בתור` : undefined}
        />
        <StatCard
          label="לחצו על שדרוג (7 ימים)"
          value={funnel.upgradeClicks7d}
          sub={`${funnel.upgradeClicksSignedOut7d} מהם ללא התחברות`}
          tone="accent"
        />
        <StatCard
          label="המרה לצפייה במסלולים"
          value={funnel.conversionPct == null ? "—" : `${funnel.conversionPct}%`}
          sub={`${funnel.pricingViews7d} מבקרים ראו את הטבלה`}
        />
      </div>

      {/* ── Product events ──────────────────────────────── */}
      <Section
        title="מדדי מוצר"
        icon={BarChart3}
        hint="נאספים גם ממבקרים שלא מחוברים — לחיצת השדרוג החשובה ביותר קורית לפני שנפתח חשבון. אירועים זהים מאותו מבקר בתוך 10 דקות נספרים כאחד."
      >
        {!snapshot.eventsReady ? (
          <Empty>המיגרציה טרם הוחלה.</Empty>
        ) : (
          <div className="space-y-4">
            <div>
              <div className="mb-1 text-[11px] font-medium text-muted">
                לחיצות שדרוג, 14 הימים האחרונים
              </div>
              <MiniBars data={snapshot.upgradeDaily} />
            </div>

            <TableWrap>
              <table className="w-full min-w-[560px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border text-[11px] text-muted">
                    <th className="p-2 text-start font-medium">אירוע</th>
                    <th className="p-2 text-start font-medium">24 שעות</th>
                    <th className="p-2 text-start font-medium">7 ימים</th>
                    <th className="p-2 text-start font-medium">מבקרים ייחודיים</th>
                    <th className="p-2 text-start font-medium">ללא התחברות</th>
                    <th className="p-2 text-start font-medium">אחרון</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.events.map((event) => (
                    <tr key={event.name} className="border-b border-border/60">
                      <td className="p-2">
                        <div className="font-medium text-primary">{EVENT_LABEL[event.name]}</div>
                        <Mono>{event.name}</Mono>
                      </td>
                      <td className="num p-2 text-primary">{event.total24h}</td>
                      <td className="num p-2 text-primary">{event.total7d}</td>
                      <td className="num p-2 text-primary">{event.subjects7d}</td>
                      <td className="num p-2 text-muted">{event.signedOut7d}</td>
                      <td className="p-2 text-[11px] text-muted">{formatWhen(event.lastAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </div>
        )}
      </Section>

      {/* ── People ──────────────────────────────────────── */}
      <Section
        title="משתמשים"
        icon={Users}
        hint="המסלול נקבע כאן, והעמודה בבסיס הנתונים היא מקור האמת היחיד — אין משתנה סביבה שיכול לסתור אותה. שורה שמסומנת ״מ-ENV (מיושן)״ היא שריד מהתקופה שלפני כן."
      >
        <UsersTable users={snapshot.users} />
      </Section>

      {/* ── Delivery ────────────────────────────────────── */}
      <Section
        title="שליחות שנכשלו"
        icon={AlertTriangle}
        hint="ניקוי שורה מחזיר את המכרז למועמדות לשליחה בריצה הבאה. תקנו קודם את הסיבה — אחרת הוא ייכשל שוב באותו אופן."
      >
        <FailuresTable failures={snapshot.failures} />
      </Section>

      <Section title="ריצות של מנוע ההתראות" icon={Activity}>
        {snapshot.runs.length === 0 ? (
          <Empty>אין עדיין ריצות מתועדות.</Empty>
        ) : (
          <TableWrap>
            <table className="w-full min-w-[680px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-[11px] text-muted">
                  <th className="p-2 text-start font-medium">מצב</th>
                  <th className="p-2 text-start font-medium">התחילה</th>
                  <th className="p-2 text-start font-medium">מועמדים</th>
                  <th className="p-2 text-start font-medium">התאמות</th>
                  <th className="p-2 text-start font-medium">נשלחו</th>
                  <th className="p-2 text-start font-medium">נכשלו</th>
                  <th className="p-2 text-start font-medium">שגיאה</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.runs.map((run, index) => (
                  <tr key={`${run.startedAt}-${index}`} className="border-b border-border/60">
                    <td className="p-2">
                      <div className="flex flex-wrap items-center gap-1">
                        <Pill tone={run.error ? "negative" : "muted"}>{run.mode}</Pill>
                        {run.dryRun && <Pill tone="warning">יבש</Pill>}
                        {!run.finishedAt && !run.error && <Pill tone="accent">רצה</Pill>}
                      </div>
                    </td>
                    <td className="p-2 text-[11px] text-muted">{formatWhen(run.startedAt)}</td>
                    <td className="num p-2 text-primary">{run.candidates}</td>
                    <td className="num p-2 text-primary">{run.matched}</td>
                    <td className="num p-2 text-positive">{run.sent}</td>
                    <td className={`num p-2 ${run.failed > 0 ? "text-negative" : "text-muted"}`}>
                      {run.failed}
                    </td>
                    <td className="max-w-[220px] p-2 text-[11px] break-words text-negative" dir="ltr">
                      {run.error ?? ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Section>

      {/* ── Infrastructure ──────────────────────────────── */}
      <div className="grid gap-4 md:grid-cols-2">
        <Section title="צנרת הנתונים" icon={Database}>
          <dl className="space-y-2 text-sm">
            <Row label="מכרזים פעילים / סה״כ" value={`${pipeline.active} / ${pipeline.deals}`} />
            <Row
              label="גיאוקודינג"
              value={`${pipeline.geocoded} (${pipeline.parcelPrecision} ברמת חלקה)`}
            />
            <Row label="מכרזי רמ״י שנבדקו" value={String(pipeline.tendersSeen)} />
            <Row label="בדיקה אחרונה" value={formatWhen(pipeline.lastCheckedAt)} />
            <Row label="מכרז חדש אחרון" value={formatWhen(pipeline.lastSeenAt)} />
            <Row label="עדכון אחרון" value={formatWhen(pipeline.lastUpdatedAt)} />
          </dl>
        </Section>

        <Section title="ערוצי שליחה" icon={Mail}>
          <dl className="space-y-2 text-sm">
            <Row label="מתג ראשי" value={health.enabled ? "דולק" : "כבוי"} />
            <Row label="אימייל" value={health.email === "not_configured" ? "לא מוגדר" : health.email} />
            <Row label="כתובת שולח" value={health.emailFrom ?? "—"} ltr />
            <Row
              label="וואטסאפ"
              value={health.whatsapp === "not_configured" ? "לא מוגדר" : health.whatsapp}
            />
          </dl>
          {health.missing.length > 0 && (
            <div className="mt-3 rounded-lg border border-border bg-surface-2 p-2.5">
              <div className="mb-1 text-[11px] font-semibold text-muted">חסר בהגדרות:</div>
              <ul className="space-y-0.5">
                {health.missing.map((item) => (
                  <li key={item}>
                    <Mono>{item}</Mono>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Section>
      </div>

      {/* ── Who changed what ────────────────────────────── */}
      <Section title="יומן פעולות מנהל" icon={History}>
        {snapshot.audit.length === 0 ? (
          <Empty>עדיין לא בוצעו פעולות.</Empty>
        ) : (
          <ul className="space-y-1.5">
            {snapshot.audit.map((entry, index) => (
              <li
                key={`${entry.createdAt}-${index}`}
                className="flex flex-wrap items-center gap-2 border-b border-border/60 pb-1.5 text-xs"
              >
                <span className="text-[11px] text-muted">{formatWhen(entry.createdAt)}</span>
                <Pill tone="muted">{entry.action}</Pill>
                {entry.subject && <Mono title={entry.subject}>{entry.subject.slice(0, 20)}…</Mono>}
                {Object.keys(entry.detail).length > 0 && (
                  <Mono>{JSON.stringify(entry.detail).slice(0, 90)}</Mono>
                )}
                <span className="text-[11px] text-faint">· {entry.actorId.slice(0, 12)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

function Row({ label, value, ltr }: { label: string; value: string; ltr?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/60 pb-1.5">
      <dt className="text-xs text-muted">{label}</dt>
      <dd
        className={`text-sm font-semibold text-primary ${ltr ? "num" : ""}`}
        dir={ltr ? "ltr" : undefined}
      >
        {value}
      </dd>
    </div>
  );
}
