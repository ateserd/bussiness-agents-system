"use client";

import { useEffect, useRef } from "react";

/**
 * Ambient particle field behind the deck. Deliberately restrained: slow drift,
 * low opacity, one in nine warm to echo the owner's gold. Stops entirely under
 * prefers-reduced-motion and when the tab is hidden.
 */
export function Starfield() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let stars: { x: number; y: number; r: number; a: number; d: number; p: number }[] = [];

    const seed = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.max(45, Math.min(140, Math.round((window.innerWidth * window.innerHeight) / 17000)));
      stars = Array.from({ length: count }, () => ({
        x: Math.random() * window.innerWidth,
        y: Math.random() * window.innerHeight,
        r: Math.random() * 1.1 + 0.25,
        a: Math.random() * 0.42 + 0.07,
        d: Math.random() * 0.5 + 0.12,
        p: Math.random() * Math.PI * 2,
      }));
    };

    const paint = (t: number) => {
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      for (let i = 0; i < stars.length; i++) {
        const s = stars[i];
        const twinkle = reduced ? 1 : 0.6 + 0.4 * Math.sin(t / 1500 + s.p);
        ctx.globalAlpha = s.a * twinkle;
        ctx.fillStyle = i % 9 === 0 ? "#f5c451" : "#cfe2f5";
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
        if (!reduced) {
          s.y -= s.d * 0.1;
          if (s.y < -2) {
            s.y = window.innerHeight + 2;
            s.x = Math.random() * window.innerWidth;
          }
        }
      }
      ctx.globalAlpha = 1;
      if (!reduced) raf = requestAnimationFrame(paint);
    };

    const start = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(paint);
    };
    const onVisibility = () => {
      if (document.hidden) cancelAnimationFrame(raf);
      else if (!reduced) start();
    };

    seed();
    if (reduced) paint(0);
    else start();

    const onResize = () => {
      seed();
      if (reduced) paint(0);
    };
    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return <canvas ref={ref} className="mc-stars" aria-hidden />;
}
