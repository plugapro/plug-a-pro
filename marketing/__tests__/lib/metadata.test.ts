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
});
