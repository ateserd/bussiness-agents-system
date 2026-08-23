"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { copy } from "@/lib/copy";

const VIEWS = [
  { href: "/", label: copy.nav.today },
  { href: "/pipeline", label: copy.nav.pipeline },
  { href: "/ledger", label: copy.nav.money },
  { href: "/brain", label: copy.nav.memory },
];

/**
 * The four views, named for what they hold rather than for what the system
 * does to them. Paths stay English — the house rule is Turkish interface,
 * English code, and a URL is closer to code; the owner only ever sees the
 * labels.
 */
export function TopBar({ caption, children }: { caption?: string; children?: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <header className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4 px-4 pt-6 pb-5 sm:px-8 sm:pt-8">
      <div>
        <h1 className="m-0 text-[19px] font-bold leading-none tracking-[0.02em]">
          {copy.wordmark.lead} <span style={{ color: "var(--accent)" }}>{copy.wordmark.tail}</span>
        </h1>
        {caption && (
          <p className="m-0 mt-1.5 text-[13px]" style={{ color: "var(--ink-3)" }}>
            {caption}
          </p>
        )}
      </div>

      <div className="flex items-center gap-3">
        {children}
        <nav className="flex flex-wrap gap-1.5" aria-label="Görünümler">
          {VIEWS.map((view) => {
            const active = view.href === "/" ? pathname === "/" : pathname.startsWith(view.href);
            return (
              <Link
                key={view.href}
                href={view.href}
                aria-current={active ? "page" : undefined}
                // 44px minimum touch target — this is read on a phone first.
                className="flex min-h-[36px] items-center rounded-full border px-3.5 text-[12.5px] transition-colors"
                style={
                  active
                    ? { color: "var(--bg)", background: "var(--accent)", borderColor: "var(--accent)", fontWeight: 600 }
                    : { color: "var(--ink-3)", borderColor: "var(--line)" }
                }
              >
                {view.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
