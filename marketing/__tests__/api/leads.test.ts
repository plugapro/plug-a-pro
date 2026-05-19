import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/leads/route";
import { checkMarketingLeadRateLimit } from "@/lib/rate-limit";

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

describe("POST /api/leads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    marketingInsertMock.mockResolvedValue({ error: null });
    intakeInsertMock.mockResolvedValue({ error: null });
    vi.mocked(checkMarketingLeadRateLimit).mockResolvedValue({ ok: true });
  });

  it("returns 200 for valid waitlist submission", async () => {
    const req = makeRequest({ type: "waitlist", email: "test@example.com" });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  it("returns 400 for missing email", async () => {
    const req = makeRequest({ type: "waitlist" });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid email format", async () => {
    const req = makeRequest({ type: "waitlist", email: "not-an-email" });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid type", async () => {
    const req = makeRequest({ type: "newsletter", email: "test@example.com" });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("accepts contact type with name and message", async () => {
    const req = makeRequest({
      type: "contact",
      email: "user@example.com",
      name: "Alice",
      message: "Hello there",
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
  });

  it("returns a WhatsApp handoff URL for minimal onboarding submission", async () => {
    const req = makeRequest({
      type: "onboarding",
      phone: "+27821234567",
      journey: "customer",
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.whatsappUrl).toContain("wa.me");
    expect(fromMock).toHaveBeenCalledWith("marketing_leads");
    expect(fromMock).toHaveBeenCalledWith("onboarding_intakes");
  });

  it("returns correct prefill message for provider journey", async () => {
    const req = makeRequest({
      type: "onboarding",
      phone: "+27821234567",
      journey: "provider",
    });
    const res = await POST(req);
    const json = await res.json();
    expect(json.whatsappUrl).toContain("service+provider");
  });

  it("accepts SA local format phone number", async () => {
    const req = makeRequest({
      type: "onboarding",
      phone: "0821234567",
      journey: "customer",
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
  });

  it("rejects onboarding submissions without a phone number", async () => {
    const req = makeRequest({
      type: "onboarding",
      journey: "customer",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("rejects onboarding submissions without a journey", async () => {
    const req = makeRequest({
      type: "onboarding",
      phone: "+27821234567",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 503 when durable rate limiting is unavailable", async () => {
    vi.mocked(checkMarketingLeadRateLimit).mockResolvedValueOnce({
      ok: false,
      code: "limiter_unavailable",
      retryAfterMs: 60_000,
    });

    const req = makeRequest({ type: "waitlist", email: "test@example.com" });
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(json.error).toMatch(/temporarily unavailable/i);
  });
});
