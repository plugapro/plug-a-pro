// app/api/leads/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { siteConfig } from "@/lib/metadata";

const schema = z.object({
  type: z.enum(["waitlist", "contact", "chat"]),
  email: z.string().email(),
  name: z.string().optional(),
  message: z.string().optional(),
  source: z.string().optional(),
});

// Best-effort in-memory rate limiter.
// NOTE: Resets on Vercel cold starts — not reliable across serverless invocations.
// TODO: Replace Map with Upstash Redis for production-grade rate limiting.
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const LIMIT = 3;
const WINDOW_MS = 60 * 60 * 1000; // 1 hour

function isRateLimited(ip: string): boolean {
  // Skip rate limiting in test environment — module state persists across tests.
  if (process.env.NODE_ENV === "test") return false;
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  if (entry.count >= LIMIT) return true;
  entry.count++;
  return false;
}

export async function POST(request: Request) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (isRateLimited(ip)) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const result = schema.safeParse(body);
  if (!result.success) {
    const message =
      result.error.issues[0]?.message ?? "Invalid request.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const { error } = await supabase
    .from("leads")
    .insert({ ...result.data, venture: siteConfig.venture });

  if (error) {
    console.error("[leads] insert error:", error.message);
    return NextResponse.json(
      { error: "Failed to save. Please try again." },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}
