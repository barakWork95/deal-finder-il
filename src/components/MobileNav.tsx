"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutGrid, Bell, type LucideIcon } from "lucide-react";

const TABS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/", label: "פיד עסקאות", icon: LayoutGrid },
  { href: "/alerts", label: "התראות", icon: Bell },
];

/** Bottom tab bar — mobile only (the header nav links are hidden < md). */
export function MobileNav() {
  const pathname = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-bg/90 backdrop-blur md:hidden">
      <div className="mx-auto flex max-w-md">
        {TABS.map((t) => {
          const active = t.href === "/" ? pathname === "/" : pathname.startsWith(t.href);
          const Icon = t.icon;
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition ${
                active ? "text-accent" : "text-muted"
              }`}
            >
              <Icon size={20} />
              {t.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
