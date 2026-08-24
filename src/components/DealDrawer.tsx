"use client";

import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { X, Maximize2 } from "lucide-react";

/**
 * The shell around an intercepted /deal/[id]: backdrop, panel, and the three
 * ways out (Escape, the backdrop, the close button).
 *
 * A shell and nothing more. Everything with a number in it arrives already
 * rendered as `children` from the server component that opened this, so the
 * browser is handed markup rather than the deal — which is what keeps the PRO
 * projection out of a payload anyone can read. See DealDetailBody.
 */
export function DealDrawer({
  children,
  fullHref,
  title,
}: {
  children: React.ReactNode;
  /** The un-intercepted URL, for opening this tender as a full page. */
  fullHref: string;
  title: string;
}) {
  const router = useRouter();
  const panelRef = useRef<HTMLDivElement>(null);
  // Whatever had focus on the feed, so closing puts it back rather than
  // dropping the caret at the top of the document.
  const restoreTo = useRef<HTMLElement | null>(null);

  const close = useCallback(() => {
    // back(), not push("/"): the drawer is a history entry, so this also makes
    // the browser's own back button close it exactly once.
    router.back();
  }, [router]);

  useEffect(() => {
    restoreTo.current = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    return () => restoreTo.current?.focus?.();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [close]);

  // The feed behind the drawer must not scroll under it. Restoring the
  // previous value rather than clearing it keeps a second drawer — or any
  // other lock — from being undone by this one unmounting.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex justify-start" role="presentation">
      <div
        className="drawer-backdrop absolute inset-0 bg-black/60 backdrop-blur-[2px]"
        onClick={close}
        aria-hidden
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="drawer-panel relative ms-auto flex h-full w-full max-w-[860px] flex-col border-s border-border bg-bg shadow-2xl outline-none"
      >
        {/* Toolbar stays put while the body scrolls — on a long tender the
            close button would otherwise scroll away. */}
        <div className="flex shrink-0 items-center gap-2 border-b border-border bg-surface px-4 py-3">
          <button
            onClick={close}
            aria-label="סגירה"
            className="inline-flex items-center justify-center rounded-lg border border-border bg-surface-2 p-2 text-muted transition hover:border-border-strong hover:text-primary"
          >
            <X size={16} />
          </button>
          <h2 className="min-w-0 flex-1 truncate text-sm font-bold text-primary">{title}</h2>
          {/* A plain <a>, deliberately — not next/link.

              The drawer masks the URL, so `fullHref` is the address the browser
              is already showing. Asking the router to navigate there is asking
              it to navigate to itself: it drops the feed out of the `children`
              slot, finds nothing to put in its place because the interception
              still owns this URL, and leaves the drawer floating over an empty
              <main>. A real document navigation is the only way to reach the
              standalone page, since that page only exists when this URL is
              requested *without* the interception in front of it.

              An anchor rather than an onClick handler so that middle-click,
              cmd-click and "copy link address" keep working — a button that
              assigns window.location would quietly break all three. */}
          <a
            href={fullHref}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-xs font-semibold text-primary transition hover:border-accent"
            title="פתיחה בעמוד מלא"
          >
            <Maximize2 size={13} /> עמוד מלא
          </a>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">{children}</div>
      </div>
    </div>
  );
}
