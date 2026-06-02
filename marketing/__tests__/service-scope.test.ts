import { describe, expect, it } from "vitest";
import {
  getServiceScopeBySlug,
  getServicesByStatus,
  serviceScopeMatrix,
} from "@/content/services/service-scope";
import {
  buildWhatsAppServiceMessage,
  canRequestServiceInMvp,
  resolveServiceScopeStatus,
} from "@/lib/services/scopeRules";

describe("service scope matrix", () => {
  it("contains green, amber and red services", () => {
    expect(getServicesByStatus("GREEN").length).toBeGreaterThan(0);
    expect(getServicesByStatus("AMBER").length).toBeGreaterThan(0);
    expect(getServicesByStatus("RED").length).toBeGreaterThan(0);
  });

  it("keeps regulated or large works out of automatic MVP request scope", () => {
    expect(canRequestServiceInMvp("tap-repairs")).toBe(true);
    expect(canRequestServiceInMvp("regulated-electrical")).toBe(false);
    expect(canRequestServiceInMvp("renovations")).toBe(false);
  });

  it("resolves common service aliases to the right scope status", () => {
    expect(resolveServiceScopeStatus("minor plumbing leak")).toBe("AMBER");
    expect(resolveServiceScopeStatus("room painting")).toBe("GREEN");
    expect(resolveServiceScopeStatus("new building construction")).toBe("RED");
  });

  it("builds a WhatsApp message with the service context but no unsafe claims", () => {
    const message = buildWhatsAppServiceMessage(getServiceScopeBySlug("tap-repairs"));

    expect(message).toContain("tap");
    expect(message).toContain("small job");
    expect(message).not.toMatch(/fixed price|guaranteed|verified/i);
  });

  it("gives every service a unique slug and status", () => {
    const slugs = new Set(serviceScopeMatrix.map((service) => service.slug));

    expect(slugs.size).toBe(serviceScopeMatrix.length);
    expect(serviceScopeMatrix.every((service) => service.status)).toBe(true);
  });
});
