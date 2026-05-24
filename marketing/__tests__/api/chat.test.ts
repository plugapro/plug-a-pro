import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkMarketingLeadRateLimit } from "@/lib/rate-limit";

const { fromMock, insertMock, streamTextMock } = vi.hoisted(() => ({
  insertMock: vi.fn().mockResolvedValue({ error: null }),
  fromMock: vi.fn(() => ({ insert: insertMock })),
  streamTextMock: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: fromMock,
  },
}));

vi.mock("@/lib/rate-limit", () => ({
  checkMarketingLeadRateLimit: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock("@/lib/chat-context", () => ({
  buildChatSystemPrompt: vi.fn().mockResolvedValue("system prompt"),
}));

vi.mock("ai", () => ({
  convertToModelMessages: vi.fn(async (messages) => messages),
  tool: vi.fn((definition) => definition),
  streamText: streamTextMock,
}));

function makeRequest(body: unknown, ip = "203.0.113.10"): Request {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": ip,
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/chat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertMock.mockResolvedValue({ error: null });
    vi.mocked(checkMarketingLeadRateLimit).mockResolvedValue({ ok: true });
    streamTextMock.mockReturnValue({
      toUIMessageStreamResponse: () => new Response("stream", { status: 200 }),
    });
  });

  it("rate limits chat requests before invoking the model", async () => {
    vi.mocked(checkMarketingLeadRateLimit).mockResolvedValueOnce({
      ok: false,
      code: "rate_limited",
      retryAfterMs: 30_000,
    });
    const { POST } = await import("@/app/api/chat/route");

    const res = await POST(makeRequest({ messages: [{ role: "user", parts: [{ type: "text", text: "hello" }] }] }));

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("30");
    expect(streamTextMock).not.toHaveBeenCalled();
  });

  it("captures chat leads in marketing_leads", async () => {
    const { POST } = await import("@/app/api/chat/route");
    const res = await POST(makeRequest({ messages: [{ role: "user", parts: [{ type: "text", text: "email me" }] }] }));
    expect(res.status).toBe(200);

    const config = streamTextMock.mock.calls[0][0];
    const result = await config.tools.captureLead.execute({ email: "lead@example.com" });

    expect(result).toEqual({ captured: true });
    expect(fromMock).toHaveBeenCalledWith("marketing_leads");
    expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({
      type: "chat",
      email: "lead@example.com",
      source: "chat-widget",
    }));
  });

  it("keeps the service-role Supabase client server-only", () => {
    const source = readFileSync(join(process.cwd(), "lib/supabase.ts"), "utf8");
    expect(source).toContain('import "server-only";');
  });
});
