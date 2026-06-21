"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { captureAttributionFromLocation } from "@/lib/attribution";
import { isSensitiveTokenRoute } from "@/lib/sensitive-token-routes";

// Mount once in the root layout. Captures UTMs, click IDs, referrer and
// landing path on every route change so a tagged internal link is treated as
// a last-touch refresh while first-touch is preserved. Token routes are
// suppressed so a magic-link URL never lands in localStorage (mirrors the
// field-service guard; no such routes exist on the marketing site today).
export function AttributionCapture() {
  const pathname = usePathname();
  useEffect(() => {
    if (isSensitiveTokenRoute(pathname)) return;
    captureAttributionFromLocation();
  }, [pathname]);
  return null;
}
