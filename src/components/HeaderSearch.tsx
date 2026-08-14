"use client";

import { usePathname, useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import { clearSearch, setSearchInput, useSearchInput } from "@/lib/search-store";

/**
 * Header search. It filters the feed through the search store; typing from any
 * other page (a tender, the personal area) sends you to the feed first, since
 * that is the only place the results can appear.
 */
export function HeaderSearch() {
  const value = useSearchInput();
  const pathname = usePathname();
  const router = useRouter();

  function onChange(next: string) {
    setSearchInput(next);
    if (next.trim() !== "" && pathname !== "/") router.push("/");
  }

  return (
    <div className="relative flex-1 max-w-md">
      <Search
        size={16}
        aria-hidden
        className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-faint"
      />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") clearSearch();
        }}
        aria-label="חיפוש מכרזים"
        placeholder="חיפוש: עיר, אזור, גוש/חלקה…"
        className="w-full rounded-lg border border-border bg-surface py-2 pe-9 ps-8 text-sm text-primary placeholder:text-faint outline-none focus:border-accent"
      />
      {value !== "" && (
        <button
          type="button"
          onClick={clearSearch}
          aria-label="ניקוי החיפוש"
          className="absolute start-2 top-1/2 -translate-y-1/2 rounded p-1 text-faint transition hover:text-primary"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}
