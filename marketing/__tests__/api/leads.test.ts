import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/leads/route";

// Mock the supabase module
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn().mockReturnValue({
      insert: vi.fn().mockResolvedValue({ error: null }),
    }),
  },
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
});
