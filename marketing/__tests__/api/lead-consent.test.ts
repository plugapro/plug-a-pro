import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/leads/route";
import { marketingConsentText } from "@/content/marketing/consent";

const { marketingInsertMock, intakeInsertMock, fromMock } = vi.hoisted(() => ({
  marketingInsertMock: vi.fn().mockResolvedValue({ error: null }),
  intakeInsertMock: vi.fn().mockResolvedValue({ error: null }),
  fromMock: vi.fn((table: string) => ({
    insert: table === "onboarding_intakes" ? intakeInsertMock : marketingInsertMock,
  })),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: fromMock,
  },
}));

vi.mock("@/lib/rate-limit", () => ({
  checkMarketingLeadRateLimit: vi.fn().mockResolvedValue({ ok: true }),
}));

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/leads", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": "127.0.0.1",
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/leads consent capture", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    marketingInsertMock.mockResolvedValue({ error: null });
    intakeInsertMock.mockResolvedValue({ error: null });
  });

  it("requires WhatsApp consent for onboarding handoff", async () => {
    const res = await POST(
      makeRequest({
        type: "onboarding",
        phone: "+27821234567",
        journey: "provider",
      }),
    );

    expect(res.status).toBe(400);
    expect(marketingInsertMock).not.toHaveBeenCalled();
  });

  it("records consent metadata for onboarding handoff", async () => {
    const res = await POST(
      makeRequest({
        type: "onboarding",
        phone: "+27821234567",
        journey: "provider",
        whatsappConsentAccepted: true,
      }),
    );

    expect(res.status).toBe(200);
    expect(marketingInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        whatsapp_opt_in: true,
        consent_text: marketingConsentText.whatsappTransactional.body,
        consent_text_version: marketingConsentText.whatsappTransactional.version,
        consent_source: "marketing:onboarding",
        consent_accepted_at: expect.any(String),
      }),
    );
    expect(intakeInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          consentTextVersion: marketingConsentText.whatsappTransactional.version,
        }),
      }),
    );
  });

  it("requires WhatsApp consent for lead magnet handoff", async () => {
    const res = await POST(
      makeRequest({
        type: "lead_magnet",
        phone: "+27821234567",
        magnet: "dispatch-checklist",
      }),
    );

    expect(res.status).toBe(400);
    expect(marketingInsertMock).not.toHaveBeenCalled();
  });
});
