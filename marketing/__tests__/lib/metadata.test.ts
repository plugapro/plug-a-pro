import { describe, it, expect } from "vitest";
import { siteConfig, buildMetadata } from "@/lib/metadata";

describe("siteConfig", () => {
  it("has required fields", () => {
    expect(siteConfig.venture).toBeTruthy();
    expect(siteConfig.name).toBeTruthy();
    expect(siteConfig.description).toBeTruthy();
    expect(siteConfig.url).toBeTruthy();
  });
});

describe("buildMetadata", () => {
  it("includes site name in title", () => {
    const meta = buildMetadata({ title: "Pricing" });
    expect(meta.title).toBe(`Pricing | ${siteConfig.name}`);
  });

  it("falls back to site description", () => {
    const meta = buildMetadata({});
    expect(meta.description).toBe(siteConfig.description);
  });

  it("defaults canonical to the site root when no path supplied", () => {
    const meta = buildMetadata({});
    expect(meta.alternates?.canonical).toBe(siteConfig.url);
  });

  it("resolves a relative canonical path against the site URL", () => {
    const meta = buildMetadata({ canonical: "/services/electrician" });
    expect(meta.alternates?.canonical).toBe(`${siteConfig.url}/services/electrician`);
    // openGraph URL follows the canonical so the share preview matches.
    expect(meta.openGraph?.url).toBe(`${siteConfig.url}/services/electrician`);
  });

  it("applies noIndex robots when requested", () => {
    const meta = buildMetadata({ noIndex: true });
    expect(meta.robots).toEqual({ index: false, follow: false });
  });
});
