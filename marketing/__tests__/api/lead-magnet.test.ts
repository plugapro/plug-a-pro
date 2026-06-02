// __tests__/api/lead-magnet.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/leads/route";

const { marketingInsertMock, fromMock } = vi.hoisted(() => ({
  marketingInsertMock: vi.fn().mockResolvedValue({ error: null }),
  fromMock: vi.fn(() => ({
    insert: marketingInsertMock,
  })),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { from: fromMock },
}));

vi.mock("@/lib/rate-limit", () => ({
  checkMarketingLeadRateLimit: vi.fn().mockResolvedValue({ ok: true }),
}));

function makeRequest(body: unknown, ip = "127.0.0.1"): Request {
  return new Request("http://localhost/api/leads", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": ip,
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/leads - lead_magnet type", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    marketingInsertMock.mockResolvedValue({ error: null });
  });

  it("returns 200 and a WhatsApp URL for template-pack magnet", async () => {
    const req = makeRequest({
      type: "lead_magnet",
      phone: "+27821234567",
      magnet: "template-pack",
      whatsappConsentAccepted: true,
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.whatsappUrl).toContain("wa.me");
    expect(json.whatsappUrl).toContain("template");
  });

  it("returns 200 and a WhatsApp URL for dispatch-checklist magnet", async () => {
    const req = makeRequest({
      type: "lead_magnet",
      phone: "+27821234567",
      magnet: "dispatch-checklist",
      whatsappConsentAccepted: true,
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.whatsappUrl).toContain("checklist");
  });

  it("returns 200 and a WhatsApp URL for cashflow-tracker magnet", async () => {
    const req = makeRequest({
      type: "lead_magnet",
      phone: "+27821234567",
      magnet: "cashflow-tracker",
      whatsappConsentAccepted: true,
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.whatsappUrl).toContain("cash+flow");
  });

  it("inserts into marketing_leads with type lead_magnet", async () => {
    const req = makeRequest({
      type: "lead_magnet",
      phone: "+27821234567",
      magnet: "template-pack",
      whatsappConsentAccepted: true,
    });
    await POST(req);
    expect(fromMock).toHaveBeenCalledWith("marketing_leads");
    const insertArg = marketingInsertMock.mock.calls[0]?.[0];
    expect(insertArg).toMatchObject({
      type: "lead_magnet",
      phone: "+27821234567",
      whatsapp_opt_in: true,
    });
  });

  it("normalises SA local format phone number", async () => {
    const req = makeRequest({
      type: "lead_magnet",
      phone: "0821234567",
      magnet: "template-pack",
      whatsappConsentAccepted: true,
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const insertArg = marketingInsertMock.mock.calls[0]?.[0];
    expect(insertArg.phone).toBe("+27821234567");
  });

  it("accepts optional name field", async () => {
    const req = makeRequest({
      type: "lead_magnet",
      phone: "+27821234567",
      magnet: "template-pack",
      name: "Thabo",
      whatsappConsentAccepted: true,
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const insertArg = marketingInsertMock.mock.calls[0]?.[0];
    expect(insertArg.name).toBe("Thabo");
  });

  it("rejects missing phone", async () => {
    const req = makeRequest({ type: "lead_magnet", magnet: "template-pack" });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("rejects missing magnet", async () => {
    const req = makeRequest({ type: "lead_magnet", phone: "+27821234567" });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("rejects invalid magnet value", async () => {
    const req = makeRequest({
      type: "lead_magnet",
      phone: "+27821234567",
      magnet: "nonexistent-thing",
      whatsappConsentAccepted: true,
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("does NOT insert into onboarding_intakes", async () => {
    const req = makeRequest({
      type: "lead_magnet",
      phone: "+27821234567",
      magnet: "template-pack",
      whatsappConsentAccepted: true,
    });
    await POST(req);
    const tablesCalled = fromMock.mock.calls.map((c: unknown[]) => c[0]);
    expect(tablesCalled).not.toContain("onboarding_intakes");
  });
});
