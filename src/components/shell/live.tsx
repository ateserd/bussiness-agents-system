"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { copy } from "@/lib/copy";

const POLL_MS = 5_000;

/**
 * Makes "live" mean something.
 *
 * Every view here is a server component rendering a frozen frame; without this
 * the panel showed whatever was true when the page loaded and animated dots to
 * suggest otherwise. This polls a tiny endpoint and calls `router.refresh()`
 * only when the payload actually differs — a server round trip on change, not
 * on a timer.
 *
 * Two things it deliberately does: it holds the first response as the baseline
 * so opening a page never triggers an immediate refresh, and it stops entirely
 * while the tab is hidden. A forgotten tab polling all night is a cost with no
 * reader.
 */
export function LiveDot() {
  const router = useRouter();
  const seen = useRef<string | null>(null);
  const [ok, setOk] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch("/api/state", { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const next = JSON.stringify(await res.json());
        if (cancelled) return;
        setOk(true);
        if (seen.current === null) {
          seen.current = next;
          return;
        }
        if (seen.current !== next) {
          seen.current = next;
          router.refresh();
        }
      } catch {
        // A failed poll is not worth a visible error; the dot goes quiet and
        // the next tick tries again.
        if (!cancelled) setOk(false);
      }
    }

    void check();
    const timer = setInterval(check, POLL_MS);
    document.addEventListener("visibilitychange", check);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, [router]);

  return (
    <span className="chip" style={{ borderColor: ok ? "var(--ok-line)" : "var(--line)" }}>
      <span
        className={ok ? "dot running" : "dot"}
        style={{ background: ok ? "var(--ok)" : "var(--ink-3)" }}
      />
      <span style={{ color: ok ? "var(--ok)" : "var(--ink-3)" }}>{copy.today.live}</span>
    </span>
  );
}
