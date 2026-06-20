import { describe, expect, it } from "vitest";

import {
  PILOT_AREAS,
  PILOT_AREA_SLUGS,
  getAreaBySlug,
  getAreaServiceLandingPairs,
} from "@/content/areas/area-content";
import { serviceScopeMatrix } from "@/content/services/service-scope";

describe("pilot area content", () => {
  it("exposes a non-empty pilot area list", () => {
    expect(PILOT_AREAS.length).toBeGreaterThan(0);
    expect(PILOT_AREA_SLUGS.length).toBe(PILOT_AREAS.length);
  });

  it("gives every pilot area a unique slug", () => {
    const slugs = new Set(PILOT_AREAS.map((area) => area.slug));
    expect(slugs.size).toBe(PILOT_AREAS.length);
  });

  it("gives every pilot area a non-empty intro and at least four suburbs", () => {
    for (const area of PILOT_AREAS) {
      expect(area.intro.trim().length).toBeGreaterThan(0);
      expect(area.name.trim().length).toBeGreaterThan(0);
      expect(area.province.trim().length).toBeGreaterThan(0);
      expect(area.suburbs.length).toBeGreaterThanOrEqual(4);
    }
  });

  it("returns null for unknown area slugs", () => {
    expect(getAreaBySlug("not-a-real-city")).toBeNull();
  });

  it("returns the matching area for a known slug", () => {
    const first = PILOT_AREAS[0];
    expect(getAreaBySlug(first.slug)).toEqual(first);
  });

  it("produces a non-empty area-service landing pair list", () => {
    const pairs = getAreaServiceLandingPairs();
    expect(pairs.length).toBeGreaterThan(0);
  });

  it("only includes ctaMode REQUEST services in the landing pairs", () => {
    const pairs = getAreaServiceLandingPairs();
    const bookableSlugs = new Set(
      serviceScopeMatrix
        .filter((service) => service.ctaMode === "REQUEST")
        .map((service) => service.slug),
    );

    for (const pair of pairs) {
      expect(bookableSlugs.has(pair.serviceSlug)).toBe(true);
      expect(PILOT_AREA_SLUGS).toContain(pair.citySlug);
    }
  });
});
