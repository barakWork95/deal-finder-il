import Link from "next/link";
import { ThemeToggle } from "./ThemeToggle";
import { BrandMark } from "./BrandMark";
import { AuthButtons } from "./AuthButtons";
import { HeaderSearch } from "./HeaderSearch";
import { AlertsBell } from "./AlertsBell";

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
        {/* Full wordmark where there's room; just the flame on phone widths,
            so the search field keeps a usable share of the bar. */}
        <Link href="/" className="flex shrink-0 items-center" aria-label="קרקעHOT — לדף הבית">
          <BrandMark variant="flame" className="text-xl sm:hidden" />
          <BrandMark className="hidden text-xl sm:block" />
        </Link>

        {/* Global search — filters the feed live */}
        <HeaderSearch />

        <nav className="hidden items-center gap-1 md:flex">
          <NavLink href="/">פיד עסקאות</NavLink>
          <NavLink href="/alerts">התראות</NavLink>
        </nav>

        <div className="flex items-center gap-2">
          <AlertsBell />
          <ThemeToggle />
          <AuthButtons />
        </div>
      </div>
    </header>
  );
}
