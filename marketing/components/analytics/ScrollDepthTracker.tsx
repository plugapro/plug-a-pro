"use client";

import { useEffect } from "react";
import { analytics } from "@/lib/analytics";

const MILESTONES = [25, 50, 75, 100] as const;

/**
 * Fires `scroll_depth` events at 25 / 50 / 75 / 100% scroll milestones.
 * Each milestone fires only once per page load.
 * Renders nothing — pure side-effect component.
 */
export function ScrollDepthTracker() {
  useEffect(() => {
    const reached = new Set<number>();

    function onScroll() {
      const { scrollTop, scrollHeight, clientHeight } =
        document.documentElement;
      const max = scrollHeight - clientHeight;
      if (max <= 0) return;
      const pct = Math.min(100, Math.round((scrollTop / max) * 100));
      for (const m of MILESTONES) {
        if (pct >= m && !reached.has(m)) {
          reached.add(m);
          analytics.scrollDepth(m);
        }
      }
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return null;
}
