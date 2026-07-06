import { describe, expect, it } from "vitest";

import { siteConfig } from "@/lib/metadata";
import {
  breadcrumbLd,
  faqLd,
  jsonLdScript,
  localBusinessLd,
  organizationLd,
  serviceLd,
} from "@/lib/jsonld";

describe("organizationLd", () => {
  it("returns a well-formed Organization payload sourced from siteConfig", () => {
    const ld = organizationLd();
    expect(ld["@context"]).toBe("https://schema.org");
    expect(ld["@type"]).toBe("Organization");
    expect(ld.name).toBe(siteConfig.name);
    expect(ld.legalName).toBe(siteConfig.legalEntity);
    expect(ld.url).toBe(siteConfig.url);
    expect(ld.sameAs).toEqual([
      siteConfig.links.facebook,
      siteConfig.links.instagram,
    ]);
    expect(ld.contactPoint.telephone).toBe(siteConfig.whatsappNumber);
  });
});

describe("localBusinessLd", () => {
  it("returns a LocalBusiness with ZA postal address", () => {
    const ld = localBusinessLd();
    expect(ld["@type"]).toBe("LocalBusiness");
    expect(ld.address.addressCountry).toBe("ZA");
    expect(ld.areaServed).toBe("South Africa");
  });
});

describe("serviceLd", () => {
  it("builds the canonical service URL from siteConfig", () => {
    const ld = serviceLd({
      name: "Electrician",
      description: "On-demand electrical work",
      slug: "regulated-electrical",
    });
    expect(ld["@type"]).toBe("Service");
    expect(ld.url).toBe(`${siteConfig.url}/services/regulated-electrical`);
    // Plug A Pro is the marketplace arranging the service, not its performer:
    // Service must carry `broker`, never `provider` (positioning audit 2026-07-06).
    expect(ld.broker.name).toBe(siteConfig.name);
    expect("provider" in ld).toBe(false);
  });
});

describe("localBusinessLd description", () => {
  it("carries the marketplace description so structured data cannot read as a direct service business", () => {
    const ld = localBusinessLd();
    expect(ld.description).toBe(siteConfig.description);
    expect(ld.description).toContain("independent local service providers");
  });
});

describe("breadcrumbLd", () => {
  it("emits an ItemListElement with 1-indexed positions", () => {
    const ld = breadcrumbLd([
      { name: "Home", url: "https://x/" },
      { name: "Services", url: "https://x/services" },
    ]);
    expect(ld["@type"]).toBe("BreadcrumbList");
    expect(ld.itemListElement).toHaveLength(2);
    expect(ld.itemListElement[0].position).toBe(1);
    expect(ld.itemListElement[1].position).toBe(2);
  });
});

describe("faqLd", () => {
  it("emits Question/Answer pairs in a FAQPage", () => {
    const ld = faqLd([{ question: "Q?", answer: "A." }]);
    expect(ld["@type"]).toBe("FAQPage");
    expect(ld.mainEntity[0]["@type"]).toBe("Question");
    expect(ld.mainEntity[0].acceptedAnswer.text).toBe("A.");
  });
});

describe("jsonLdScript", () => {
  it("escapes < to prevent </script> breakout", () => {
    const out = jsonLdScript({ note: "</script><img src=x>" });
    expect(out).not.toContain("</script>");
    expect(out).toContain("\\u003c/script");
  });

  it("produces parseable JSON", () => {
    const payload = organizationLd();
    const out = jsonLdScript(payload);
    // Reverse the escape so JSON.parse can validate the structure.
    const parsed = JSON.parse(out.replace(/\\u003c/g, "<"));
    expect(parsed.name).toBe(siteConfig.name);
  });
});
