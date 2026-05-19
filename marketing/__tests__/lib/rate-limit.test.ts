import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const limitMock = vi.fn();

vi.mock("@upstash/ratelimit", () => {
  class MockRatelimit {
    static slidingWindow = vi.fn(() => ({ type: "sliding-window" }));

    limit = limitMock;
  }

  return { Ratelimit: MockRatelimit };
});

vi.mock("@upstash/redis", () => ({
  Redis: class MockRedis {
    type = "redis-client";
  },
}));

describe("marketing lead rate limiting", () => {
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    const { resetMarketingRateLimitForTests } = await import("@/lib/rate-limit");
    resetMarketingRateLimitForTests();
  });

  afterEach(async () => {
    process.env = { ...originalEnv };
    const { resetMarketingRateLimitForTests } = await import("@/lib/rate-limit");
    resetMarketingRateLimitForTests();
  });

  it("fails closed in production when durable limiter env vars are missing", async () => {
    process.env.VERCEL_ENV = "production";
    delete process.env.RATE_LIMIT_ALLOW_MEMORY_FALLBACK;
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    delete process.env.UPSTASH_REDIS_KV_REST_API_URL;
    delete process.env.UPSTASH_REDIS_KV_REST_API_TOKEN;
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;

    const { checkMarketingLeadRateLimit } = await import("@/lib/rate-limit");

    await expect(checkMarketingLeadRateLimit("203.0.113.10")).resolves.toEqual({
      ok: false,
      code: "limiter_unavailable",
      retryAfterMs: 60_000,
    });
  });

  it("keeps local memory fallback bounded when explicitly enabled", async () => {
    process.env.RATE_LIMIT_ALLOW_MEMORY_FALLBACK = "true";
    process.env.MARKETING_LEAD_LIMIT_PER_IP_HOUR = "1";

    const { checkMarketingLeadRateLimit } = await import("@/lib/rate-limit");

    await expect(checkMarketingLeadRateLimit("203.0.113.11")).resolves.toEqual({ ok: true });
    await expect(checkMarketingLeadRateLimit("203.0.113.11")).resolves.toMatchObject({
      ok: false,
      code: "rate_limited",
    });
  });

  it("fails closed when durable limiter throws", async () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://upstash.example.test";
    process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";
    limitMock.mockRejectedValueOnce(new Error("redis unavailable"));

    const { checkMarketingLeadRateLimit } = await import("@/lib/rate-limit");

    await expect(checkMarketingLeadRateLimit("203.0.113.12")).resolves.toEqual({
      ok: false,
      code: "limiter_unavailable",
      retryAfterMs: 60_000,
    });
  });

  it("normalizes limiter keys so forwarded IP input cannot create oversized Redis keys", async () => {
    const { normalizeMarketingRateLimitKey } = await import("@/lib/rate-limit");

    expect(normalizeMarketingRateLimitKey(" 203.0.113.15, 10.0.0.1 ")).toBe("ip:203.0.113.15");
    expect(normalizeMarketingRateLimitKey("bad user input ".repeat(20))).toMatch(
      /^opaque:[a-z0-9_.:-]{1,64}$/
    );
  });
});
