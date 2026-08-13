"use client";

import type { LucideIcon } from "lucide-react";

/** Small shared controls for the personal-area panels. */

export function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
        active
          ? "border-accent bg-accent-soft text-accent"
          : "border-border bg-surface-2 text-muted hover:text-primary"
      }`}
    >
      {children}
    </button>
  );
}

export function IconBtn({
  onClick,
  title,
  children,
  tone = "default",
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
  tone?: "default" | "danger";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`flex h-8 w-8 items-center justify-center rounded-lg border bg-surface-2 transition ${
        tone === "danger"
          ? "border-border text-muted hover:border-negative hover:text-negative"
          : "border-border text-muted hover:border-border-strong hover:text-primary"
      }`}
    >
      {children}
    </button>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-faint">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-faint">{hint}</span>}
    </label>
  );
}

/**
 * Input with an icon inside it.
 *
 * The icon and the padding are BOTH placed physically (left), on purpose. The
 * page is RTL, so an icon at the inline-end sits on the left — but a field
 * carrying `dir="ltr"` (email, phone) resolves `pe-*` against its own
 * direction and pads the *right* instead, leaving the text to run straight
 * under the icon. Physical placement keeps the two on the same side whatever
 * direction the field itself uses. The padding comes from `.input-icon` in
 * globals.css, since unlayered `.input` outranks a Tailwind padding utility.
 */
export function IconInput({
  icon: Icon,
  className = "",
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { icon: LucideIcon }) {
  return (
    <div className="relative">
      <Icon
        size={14}
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-3 my-auto text-faint"
      />
      <input {...props} className={`input input-icon w-full ${className}`} />
    </div>
  );
}

export function EmptyState({
  title,
  children,
}: {
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-surface p-8 text-center">
      <p className="font-semibold text-primary">{title}</p>
      {children && <div className="mt-2 text-sm text-muted">{children}</div>}
    </div>
  );
}
