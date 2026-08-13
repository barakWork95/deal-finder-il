import Link from "next/link";
import { Search, Bell } from "lucide-react";
import { ThemeToggle } from "./ThemeToggle";
import { BrandMark } from "./BrandMark";

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-lg px-3 py-1.5 text-sm font-medium text-muted transition hover:bg-surface-2 hover:text-primary"
    >
      {children}
    </Link>
  );
}

export function AppHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-bg/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-4 px-4">
        {/* Logo (start = right in RTL) */}
        <Link href="/" className="flex shrink-0 items-center" aria-label="קרקעHOT — לדף הבית">
          <BrandMark className="text-lg sm:text-xl" />
        </Link>

        {/* Global search */}
        <div className="relative flex-1 max-w-md">
          <Search
            size={16}
            className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-faint"
          />
          <input
            type="search"
            placeholder="חיפוש: עיר, אזור, גוש/חלקה…"
            className="w-full rounded-lg border border-border bg-surface py-2 pe-9 ps-3 text-sm text-primary placeholder:text-faint outline-none focus:border-accent"
          />
        </div>

        <nav className="hidden items-center gap-1 md:flex">
          <NavLink href="/">פיד עסקאות</NavLink>
          <NavLink href="/alerts">התראות</NavLink>
        </nav>

        <div className="flex items-center gap-2">
          <Link
            href="/alerts"
            aria-label="התראות"
            className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface text-muted transition hover:text-primary"
          >
            <Bell size={18} />
            <span className="absolute -end-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-negative px-1 text-[10px] font-bold text-white">
              3
            </span>
          </Link>
          <ThemeToggle />
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-2 text-sm font-bold text-primary">
            ב
          </div>
        </div>
      </div>
    </header>
  );
}
