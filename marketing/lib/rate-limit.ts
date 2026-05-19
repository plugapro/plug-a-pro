import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

type RateLimitDecision =
  | { ok: true }
  | { ok: false; code: "rate_limited" | "limiter_unavailable"; retryAfterMs: number };

type MemoryWindowEntry = { count: number; windowStart: number };

const WINDOW_MS = 60 * 60 * 1000;
const memoryStore = new Map<string, MemoryWindowEntry>();

let redis: Redis | null = null;
let limiter: Ratelimit | null = null;
let degradedNotice = false;

function allowMemoryFallback() {
  if (process.env.RATE_LIMIT_ALLOW_MEMORY_FALLBACK === "true") return true;
  if (process.env.RATE_LIMIT_ALLOW_MEMORY_FALLBACK === "false") return false;
  return process.env.NODE_ENV !== "production" && process.env.VERCEL_ENV !== "production";
}

function leadLimit() {
  const parsed = Number.parseInt(process.env.MARKETING_LEAD_LIMIT_PER_IP_HOUR ?? "3", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 3;
}

function getRedis() {
  if (redis) return redis;
  const url =
    process.env.UPSTASH_REDIS_REST_URL ??
    process.env.UPSTASH_REDIS_KV_REST_API_URL ??
    process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ??
    process.env.UPSTASH_REDIS_KV_REST_API_TOKEN ??
    process.env.KV_REST_API_TOKEN;

  if (!url || !token) {
    if (!degradedNotice) {
      degradedNotice = true;
      console.warn("[marketing-rate-limit] durable Redis env vars missing");
    }
    return null;
  }

  redis = new Redis({ url, token });
  return redis;
}

function getLimiter() {
  if (limiter) return limiter;
  const redisClient = getRedis();
  if (!redisClient) return null;
  limiter = new Ratelimit({
    redis: redisClient,
    limiter: Ratelimit.slidingWindow(leadLimit(), "3600 s"),
    analytics: false,
    prefix: "marketing:leads",
  });
  return limiter;
}

function memoryConsume(key: string): RateLimitDecision {
  const now = Date.now();
  const entry = memoryStore.get(key);
  if (!entry || now - entry.windowStart > WINDOW_MS) {
    memoryStore.set(key, { count: 1, windowStart: now });
    return { ok: true };
  }
  if (entry.count >= leadLimit()) {
    return { ok: false, code: "rate_limited", retryAfterMs: WINDOW_MS - (now - entry.windowStart) };
  }
  entry.count++;
  return { ok: true };
}

export function normalizeMarketingRateLimitKey(ip: string): string {
  const candidate = ip.split(",")[0]?.trim().toLowerCase() ?? "";
  if (/^[a-f0-9:.]{3,64}$/.test(candidate)) {
    return `ip:${candidate}`;
  }

  const bounded = candidate.replace(/[^a-z0-9_.:-]/g, "_").slice(0, 64);
  return `opaque:${bounded || "unknown"}`;
}

export async function checkMarketingLeadRateLimit(ip: string): Promise<RateLimitDecision> {
  const key = normalizeMarketingRateLimitKey(ip);
  const durableLimiter = getLimiter();
  if (!durableLimiter) {
    if (!allowMemoryFallback()) {
      return { ok: false, code: "limiter_unavailable", retryAfterMs: 60_000 };
    }
    return memoryConsume(key);
  }

  try {
    const result = await durableLimiter.limit(key);
    if (result.success) return { ok: true };
    return { ok: false, code: "rate_limited", retryAfterMs: Math.max(0, result.reset - Date.now()) };
  } catch (error) {
    console.warn("[marketing-rate-limit] durable limiter failed closed", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return { ok: false, code: "limiter_unavailable", retryAfterMs: 60_000 };
  }
}

export function resetMarketingRateLimitForTests() {
  redis = null;
  limiter = null;
  degradedNotice = false;
  memoryStore.clear();
}
