"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { copy } from "@/lib/copy";

const VIEWS = [
  { href: "/", label: copy.nav.command },
  { href: "/brain", label: copy.nav.brain },
  { href: "/activity", label: copy.nav.activity },
  { href: "/ledger", label: copy.nav.ledger },
];

export function TopBar({ caption }: { caption?: string }) {
  const pathname = usePathname();

  return (
    <header className="relative z-20 flex flex-wrap items-end justify-between gap-x-8 gap-y-4 px-7 pt-7 pb-5">
      <div>
        <h1 className="m-0 text-[22px] font-extrabold uppercase leading-none tracking-[0.15em] sm:text-[26px]">
          {copy.wordmark.lead} <span style={{ color: "var(--gold)" }}>{copy.wordmark.tail}</span>
        </h1>
        <p className="mc-eyebrow mt-2.5">{caption ?? copy.tagline}</p>
      </div>

      <nav className="flex flex-wrap gap-1.5" aria-label="Görünümler">
        {VIEWS.map((view) => {
          const active = pathname === view.href;
          return (
            <Link
              key={view.href}
              href={view.href}
              aria-current={active ? "page" : undefined}
              className="rounded-full border px-3.5 py-1.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.16em] transition-colors"
              style={
                active
                  ? { color: "var(--void)", background: "var(--gold)", borderColor: "var(--gold)" }
                  : { color: "var(--dim)", borderColor: "var(--line)" }
              }
            >
              {view.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
