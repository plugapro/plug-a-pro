"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { captureAttributionFromLocation } from "@/lib/attribution";

// Mount once in the root layout. Captures UTMs, click IDs, referrer and
// landing path on every route change so a tagged internal link is treated as
// a last-touch refresh while first-touch is preserved.
export function AttributionCapture() {
  const pathname = usePathname();
  useEffect(() => {
    captureAttributionFromLocation();
  }, [pathname]);
  return null;
}
