"use client";

import { useState } from "react";
import { Check, Mail, MessageCircle, Trash2, User } from "lucide-react";
import { clearLocalData, useProfile } from "@/lib/client-store";
import { Field, IconInput } from "@/components/personal/controls";
import { ClerkSecurityLink } from "@/components/personal/ClerkSecurityLink";

/** Israeli mobile, with or without the leading zero / +972. */
const PHONE_RE = /^(\+?972|0)?5\d{8}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function AccountPanel() {
  const [profile, setProfile] = useProfile();
  const [draft, setDraft] = useState(profile);
  const [saved, setSaved] = useState(false);

  const emailError = draft.email !== "" && !EMAIL_RE.test(draft.email.trim());
  const phoneError = draft.phone !== "" && !PHONE_RE.test(draft.phone.replace(/[\s-]/g, ""));
  const dirty =
    draft.fullName !== profile.fullName ||
    draft.email !== profile.email ||
    draft.phone !== profile.phone;

  function save() {
    if (emailError || phoneError) return;
    setProfile({
      fullName: draft.fullName.trim(),
      email: draft.email.trim(),
      phone: draft.phone.replace(/[\s-]/g, ""),
    });
    setSaved(true);
  }

  return (
    <section className="space-y-5">
      <h1 className="text-xl font-extrabold text-primary">פרטי חשבון</h1>

      <div className="rounded-xl border border-border bg-surface p-5 shadow-[var(--shadow)]">
        <p className="mb-4 text-xs text-muted">
          הפרטים משמשים כיעד לשליחת ההתראות ונשמרים בדפדפן הזה בלבד — עדיין אין חשבונות מקוונים
          במערכת.
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="שם מלא">
              <IconInput
                icon={User}
                value={draft.fullName}
                onChange={(e) => {
                  setDraft({ ...draft, fullName: e.target.value });
                  setSaved(false);
                }}
                placeholder="ישראל ישראלי"
              />
            </Field>
          </div>

          <Field label="אימייל" hint="יעד להתראות אימייל ולסיכומים">
            <IconInput
              icon={Mail}
              type="email"
              dir="ltr"
              value={draft.email}
              onChange={(e) => {
                setDraft({ ...draft, email: e.target.value });
                setSaved(false);
              }}
              placeholder="you@example.com"
              className={emailError ? "border-negative" : ""}
            />
          </Field>

          <Field label="טלפון נייד" hint="יעד להתראות WhatsApp">
            <IconInput
              icon={MessageCircle}
              type="tel"
              dir="ltr"
              value={draft.phone}
              onChange={(e) => {
                setDraft({ ...draft, phone: e.target.value });
                setSaved(false);
              }}
              placeholder="050-1234567"
              className={phoneError ? "border-negative" : ""}
            />
          </Field>
        </div>

        {(emailError || phoneError) && (
          <p className="mt-3 text-[11px] text-negative">
            {emailError ? "כתובת אימייל לא תקינה. " : ""}
            {phoneError ? "מספר נייד ישראלי לא תקין (למשל 0501234567)." : ""}
          </p>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <ClerkSecurityLink />
          <span className="ms-auto" />
          {saved && !dirty && (
            <span className="flex items-center gap-1 text-xs font-semibold text-positive">
              <Check size={14} /> נשמר
            </span>
          )}
          <button
            type="button"
            onClick={save}
            disabled={!dirty || emailError || phoneError}
            className="btn-primary rounded-lg bg-accent px-5 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          >
            שמירת פרטים
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-surface p-5">
        <h2 className="text-sm font-bold text-primary">נתונים מקומיים</h2>
        <p className="mt-1 text-xs text-muted">
          מחיקה תסיר את ההתראות, העסקאות השמורות ופרטי החשבון מהדפדפן הזה. אין לכך השפעה על נתוני
          המכרזים עצמם.
        </p>
        <button
          type="button"
          onClick={() => {
            if (confirm("למחוק את כל הנתונים המקומיים? הפעולה אינה הפיכה.")) {
              clearLocalData();
              setDraft({ fullName: "", email: "", phone: "" });
              setSaved(false);
            }
          }}
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-muted transition hover:border-negative hover:text-negative"
        >
          <Trash2 size={14} /> מחיקת כל הנתונים המקומיים
        </button>
      </div>
    </section>
  );
}
