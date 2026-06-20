import { describe, expect, it } from "vitest";

import sitemap from "@/app/sitemap";
import { siteConfig } from "@/lib/metadata";
import { serviceScopeMatrix } from "@/content/services/service-scope";

describe("sitemap", () => {
  const entries = sitemap();

  it("includes the homepage with priority 1.0", () => {
    const home = entries.find((e) => e.url === siteConfig.url);
    expect(home).toBeDefined();
    expect(home?.priority).toBe(1.0);
  });

  it("includes the /services landing page", () => {
    const services = entries.find((e) => e.url === `${siteConfig.url}/services`);
    expect(services).toBeDefined();
  });

  it("includes one entry per service in serviceScopeMatrix", () => {
    for (const service of serviceScopeMatrix) {
      const match = entries.find(
        (e) => e.url === `${siteConfig.url}/services/${service.slug}`,
      );
      expect(match, `missing sitemap entry for service ${service.slug}`).toBeDefined();
      expect(match?.priority).toBe(0.8);
    }
  });

  it("never emits localhost or empty URLs", () => {
    for (const entry of entries) {
      expect(entry.url).toMatch(/^https:\/\//);
      expect(entry.url).not.toContain("localhost");
    }
  });

  it("uses recent lastModified timestamps (within a minute of build)", () => {
    const now = Date.now();
    for (const entry of entries) {
      const mod = entry.lastModified instanceof Date ? entry.lastModified : new Date(entry.lastModified ?? 0);
      expect(now - mod.getTime()).toBeLessThan(60_000);
    }
  });
});
