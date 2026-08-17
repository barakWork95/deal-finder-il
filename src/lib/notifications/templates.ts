import type { Deal } from "@/lib/types";
import { formatILS, formatLandArea } from "@/lib/format";
import { submissionInfo } from "@/lib/tender-phase";

/**
 * Hebrew, RTL message bodies for both channels.
 *
 * Two rules from the product carry over verbatim, and must not be softened to
 * make a subject line punchier:
 *
 *  1. The gap versus the official appraisal is **פער משומה**, never a
 *     "discount". A רמ"י tender is competitive — the opening minimum is a low
 *     anchor (the median winning bid runs +369% above it), so every message
 *     that quotes a gap also carries the caveat.
 *  2. עלות כניסה = minimum bid + development costs. That is the number a
 *     bidder actually needs on day one, and it is the one we lead with.
 *
 * Email is built as one inline-styled block: mail clients strip <style> and
 * have no CSS variables, so the app's palette is repeated here as literals in
 * its light form (dark-mode mail is not reliably controllable).
 */

const INK = "#0f0f24";
const MUTED = "#5b5b73";
const ACCENT = "#6f6dee";
const BG = "#f7f8fc";
const SURFACE = "#ffffff";
const BORDER = "#e3e4ef";

export type MessageDeal = Pick<
  Deal,
  | "id"
  | "city"
  | "rawAddress"
  | "zoning"
  | "areaSqm"
  | "askingPrice"
  | "dealScore"
  | "discountPct"
  | "submissionDeadline"
  | "submissionOpensAt"
  | "expectedGapPct"
>;

function dealUrl(siteUrl: string, dealId: string): string {
  return `${siteUrl}/deal/${encodeURIComponent(dealId)}`;
}

/** Escapes anything that reaches HTML — addresses come from רמ"י, not from us. */
function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Numbers stay LTR inside an RTL paragraph, as they do in the app. */
function num(value: string): string {
  return `<span dir="ltr" style="unicode-bidi:isolate">${esc(value)}</span>`;
}

function dealLine(deal: MessageDeal): string {
  const parts = [
    deal.city,
    formatLandArea(deal.areaSqm),
    deal.zoning,
    `ציון ${Math.round(deal.dealScore)}`,
  ];
  return parts.filter(Boolean).join(" · ");
}

/**
 * The date line, phase-aware.
 *
 * A tender that opens in a week and closes in eleven has two dates, and
 * quoting only the deadline tells someone they have eleven days to act when
 * they cannot act at all yet. Alerts are sent once, on first sight (the
 * delivery ledger is keyed per alert+tender+channel), so this one line has to
 * carry the state the tender was in — hence "נפתח להגשה" rather than a
 * deadline for anything still טרם החל.
 */
function dateLine(deal: MessageDeal): { label: string; date: string; relative: string } {
  const info = submissionInfo(deal);
  // Kept as three pieces: only the date is a number that needs LTR isolation.
  // Wrapping the Hebrew "(בעוד 7 ימים)" in the same isolate would reverse it.
  return { label: info.dateLabel, date: info.date, relative: info.relative };
}

// ── Email ──────────────────────────────────────────────────

function dealCard(deal: MessageDeal, siteUrl: string): string {
  const dates = dateLine(deal);
  const gap =
    deal.expectedGapPct != null && deal.expectedGapPct > 0
      ? `<div style="margin-top:6px;font-size:12px;color:#1c7c54">מתחת לשומה גם אחרי פרמיית זכייה צפויה (${num(
          `${Math.round(deal.expectedGapPct)}%`,
        )})</div>`
      : "";

  return `
    <tr>
      <td style="padding:0 0 12px 0">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
               style="background:${SURFACE};border:1px solid ${BORDER};border-radius:12px">
          <tr>
            <td style="padding:16px">
              <a href="${dealUrl(siteUrl, deal.id)}"
                 style="color:${INK};font-size:16px;font-weight:700;text-decoration:none">
                ${esc(deal.rawAddress || deal.city)}
              </a>
              <div style="margin-top:4px;font-size:13px;color:${MUTED}">${esc(dealLine(deal))}</div>
              <div style="margin-top:10px;font-size:14px;color:${INK}">
                עלות כניסה: <strong>${num(formatILS(deal.askingPrice))}</strong>
              </div>
              <div style="margin-top:4px;font-size:12px;color:${MUTED}">
                ${esc(dates.label)}: ${num(dates.date)} (${esc(dates.relative)})
              </div>
              ${gap}
            </td>
          </tr>
        </table>
      </td>
    </tr>`;
}

function emailShell(options: {
  title: string;
  intro: string;
  deals: MessageDeal[];
  siteUrl: string;
  footerNote: string;
  unsubscribeUrl?: string;
  remainder?: number;
}): string {
  const { title, intro, deals, siteUrl, footerNote, unsubscribeUrl, remainder = 0 } = options;

  const more =
    remainder > 0
      ? `<tr><td style="padding:4px 0 12px;font-size:13px;color:${MUTED}">
           ועוד ${num(String(remainder))} מכרזים תואמים —
           <a href="${siteUrl}/alerts" style="color:${ACCENT}">לצפייה בכולם</a>
         </td></tr>`
      : "";

  return `<div dir="rtl" lang="he" style="margin:0;padding:24px 12px;background:${BG};
    font-family:'Assistant',Arial,'Helvetica Neue',sans-serif;color:${INK}">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
         style="max-width:560px;margin:0 auto">
    <tr>
      <td style="padding-bottom:16px">
        <a href="${siteUrl}" style="font-size:20px;font-weight:800;color:${INK};text-decoration:none">
          קרקע<span style="color:#f97518">HOT</span>
        </a>
      </td>
    </tr>
    <tr>
      <td style="padding-bottom:4px;font-size:18px;font-weight:800">${esc(title)}</td>
    </tr>
    <tr>
      <td style="padding-bottom:16px;font-size:14px;color:${MUTED}">${esc(intro)}</td>
    </tr>
    ${deals.map((deal) => dealCard(deal, siteUrl)).join("")}
    ${more}
    <tr>
      <td style="padding-top:8px">
        <a href="${siteUrl}"
           style="display:inline-block;background:${ACCENT};color:#fff;text-decoration:none;
                  padding:10px 20px;border-radius:8px;font-size:14px;font-weight:700">
          פתיחת קרקעHOT
        </a>
      </td>
    </tr>
    <tr>
      <td style="padding-top:20px;font-size:11px;line-height:1.6;color:${MUTED}">
        ${esc(footerNote)}<br />
        מכרזי רמ"י הם תחרותיים — מחיר המינימום הוא נקודת פתיחה בלבד, והמחיר הסופי בפועל
        גבוה ממנו. הפער המוצג הוא פער מול השומה הרשמית ואינו הנחה מובטחת.
        ${
          unsubscribeUrl
            ? `<br /><a href="${unsubscribeUrl}" style="color:${MUTED}">הפסקת קבלת התראות</a>`
            : ""
        }
      </td>
    </tr>
  </table>
</div>`;
}

function textBody(lines: string[], siteUrl: string, unsubscribeUrl?: string): string {
  return [
    ...lines,
    "",
    `לצפייה בכל המכרזים: ${siteUrl}`,
    'מכרזי רמ"י תחרותיים — מחיר המינימום הוא פתיחה בלבד והפער מוצג מול השומה הרשמית, אינו הנחה מובטחת.',
    ...(unsubscribeUrl ? [`הפסקת קבלת התראות: ${unsubscribeUrl}`] : []),
  ].join("\n");
}

/** One alert fired on freshly ingested tenders (PRO, near-real-time). */
export function instantEmail(options: {
  alertName: string;
  deals: MessageDeal[];
  remainder?: number;
  siteUrl: string;
  unsubscribeUrl?: string;
}) {
  const { alertName, deals, remainder = 0, siteUrl, unsubscribeUrl } = options;
  const count = deals.length + remainder;
  const subject =
    count === 1
      ? `מכרז חדש תואם להתראה "${alertName}" — ${deals[0]?.city ?? ""}`
      : `${count} מכרזים חדשים תואמים להתראה "${alertName}"`;

  return {
    subject,
    html: emailShell({
      title: subject,
      intro: `נמצאו מכרזים חדשים שעונים על ההגדרות של "${alertName}".`,
      deals,
      remainder,
      siteUrl,
      footerNote: `נשלח כי הגדרת את ההתראה "${alertName}" בקרקעHOT.`,
      unsubscribeUrl,
    }),
    text: textBody(
      [
        subject,
        "",
        ...deals.map(
          (deal) =>
            `• ${deal.rawAddress || deal.city} — ${dealLine(deal)} — עלות כניסה ${formatILS(
              deal.askingPrice,
            )} — ${dateLine(deal).label} ${dateLine(deal).date} — ${dealUrl(siteUrl, deal.id)}`,
        ),
        ...(remainder > 0 ? [`ועוד ${remainder} מכרזים תואמים.`] : []),
      ],
      siteUrl,
      unsubscribeUrl,
    ),
  };
}

/** The free tier's daily round-up, covering every alert the person has. */
export function digestEmail(options: {
  deals: MessageDeal[];
  remainder?: number;
  alertNames: string[];
  delayed: boolean;
  siteUrl: string;
  unsubscribeUrl?: string;
}) {
  const { deals, remainder = 0, alertNames, delayed, siteUrl, unsubscribeUrl } = options;
  const count = deals.length + remainder;
  const subject = `הסיכום היומי שלך: ${count} מכרזי קרקע תואמים`;

  const intro = delayed
    ? "ריכוז המכרזים החדשים שתואמים להתראות שלך. בחשבון החינמי המכרזים נשלחים בעיכוב; במנוי PRO הם מגיעים ב-WhatsApp מיד עם פרסומם."
    : "ריכוז המכרזים החדשים שתואמים להתראות שלך.";

  return {
    subject,
    html: emailShell({
      title: subject,
      intro,
      deals,
      remainder,
      siteUrl,
      footerNote: `נשלח על בסיס ההתראות: ${alertNames.join(" · ")}.`,
      unsubscribeUrl,
    }),
    text: textBody(
      [
        subject,
        intro,
        "",
        ...deals.map(
          (deal) =>
            `• ${deal.rawAddress || deal.city} — ${dealLine(deal)} — עלות כניסה ${formatILS(
              deal.askingPrice,
            )} — ${dateLine(deal).label} ${dateLine(deal).date} — ${dealUrl(siteUrl, deal.id)}`,
        ),
        ...(remainder > 0 ? [`ועוד ${remainder} מכרזים תואמים.`] : []),
      ],
      siteUrl,
      unsubscribeUrl,
    ),
  };
}

// ── WhatsApp ───────────────────────────────────────────────

/**
 * WhatsApp gets a short body — long messages are collapsed behind "read more"
 * on the phone, which buries the link that matters.
 *
 * `templateVariables` mirrors the same content positionally for Twilio's
 * approved-template path: {{1}} alert name, {{2}} summary line, {{3}} link.
 */
export function whatsappAlert(options: {
  alertName: string;
  deals: MessageDeal[];
  remainder?: number;
  siteUrl: string;
}): { body: string; templateVariables: Record<string, string> } {
  const { alertName, deals, remainder = 0, siteUrl } = options;
  const count = deals.length + remainder;

  const items = deals
    .map(
      (deal) =>
        `• ${deal.rawAddress || deal.city} · ${formatLandArea(deal.areaSqm)} · ${formatILS(
          deal.askingPrice,
        )}\n  ${dateLine(deal).label}: ${dateLine(deal).date}\n  ${dealUrl(siteUrl, deal.id)}`,
    )
    .join("\n");

  const summary =
    count === 1
      ? `מכרז חדש תואם להתראה "${alertName}"`
      : `${count} מכרזים חדשים תואמים להתראה "${alertName}"`;

  const body = [
    `*קרקעHOT* — ${summary}`,
    "",
    items,
    remainder > 0 ? `\nועוד ${remainder} מכרזים תואמים.` : "",
    "",
    'מחיר המינימום במכרזי רמ"י הוא פתיחה בלבד; המחיר הסופי גבוה ממנו.',
    `${siteUrl}/alerts`,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    body,
    templateVariables: {
      "1": alertName,
      "2": summary,
      "3": deals[0] ? dealUrl(siteUrl, deals[0].id) : `${siteUrl}/alerts`,
    },
  };
}
