import { describe, expect, it } from "vitest";

import sitemap from "@/app/sitemap";
import {
  PILOT_AREA_SLUGS,
  getAreaServiceLandingPairs,
} from "@/content/areas/area-content";
import { siteConfig } from "@/lib/metadata";

describe("sitemap area coverage", () => {
  const entries = sitemap();

  it("includes one entry per pilot area with priority 0.7", () => {
    for (const citySlug of PILOT_AREA_SLUGS) {
      const match = entries.find(
        (entry) => entry.url === `${siteConfig.url}/areas/${citySlug}`,
      );

      expect(match, `missing sitemap entry for /areas/${citySlug}`).toBeDefined();
      expect(match?.priority).toBe(0.7);
    }
  });

  it("includes at least one area-service landing page with priority 0.8", () => {
    const pairs = getAreaServiceLandingPairs();
    expect(pairs.length).toBeGreaterThan(0);

    const [firstPair] = pairs;
    const match = entries.find(
      (entry) =>
        entry.url ===
        `${siteConfig.url}/areas/${firstPair.citySlug}/${firstPair.serviceSlug}`,
    );

    expect(match).toBeDefined();
    expect(match?.priority).toBe(0.8);
  });

  it("includes every area-service pair", () => {
    for (const pair of getAreaServiceLandingPairs()) {
      const url = `${siteConfig.url}/areas/${pair.citySlug}/${pair.serviceSlug}`;
      const match = entries.find((entry) => entry.url === url);
      expect(match, `missing sitemap entry for ${url}`).toBeDefined();
    }
  });
});
