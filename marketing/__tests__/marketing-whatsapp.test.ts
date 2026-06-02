import { describe, expect, it } from "vitest";
import {
  buildWhatsAppLink,
  whatsappAudienceOptions,
  whatsappMessages,
} from "@/lib/whatsapp";

describe("marketing WhatsApp copy", () => {
  it("does not expose worker as a public audience", () => {
    expect(Object.keys(whatsappMessages)).not.toContain("worker");
    expect(whatsappAudienceOptions.map((option) => option.audience)).not.toContain("worker");
  });

  it("uses WhatsApp-first MVP messages", () => {
    expect(whatsappMessages.customer).toMatch(/small job/i);
    expect(whatsappMessages.provider).toMatch(/service provider/i);
  });

  it("builds an encoded wa.me link without exposing credentials", () => {
    const link = buildWhatsAppLink(whatsappMessages.customer);

    expect(link).toContain("https://wa.me/");
    expect(link).toContain("text=");
    expect(link).not.toContain("token");
    expect(link).not.toContain("SUPABASE");
  });
});
