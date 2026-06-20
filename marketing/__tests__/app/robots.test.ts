import { describe, expect, it } from "vitest";

import robots from "@/app/robots";
import { siteConfig } from "@/lib/metadata";

describe("robots", () => {
  const config = robots();

  it("allows the root and disallows /api/", () => {
    const rules = Array.isArray(config.rules) ? config.rules : [config.rules];
    const allow = rules.find((r) => r.allow === "/");
    const disallow = rules.find((r) => r.disallow === "/api/");
    expect(allow).toBeDefined();
    expect(disallow).toBeDefined();
  });

  it("declares the sitemap URL on the marketing host", () => {
    expect(config.sitemap).toBe(`${siteConfig.url}/sitemap.xml`);
  });

  it("declares the canonical host", () => {
    expect(config.host).toBe(siteConfig.url);
  });
});
