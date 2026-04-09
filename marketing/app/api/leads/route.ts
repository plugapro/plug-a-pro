// app/api/leads/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { siteConfig } from "@/lib/metadata";
import { buildWhatsAppLink } from "@/lib/whatsapp";

const phoneRegex = /^\+?[1-9]\d{7,14}$/;

const baseSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  message: z.string().trim().max(1500).optional(),
  source: z.string().trim().max(120).optional(),
});

const contactSchema = baseSchema.extend({
  type: z.enum(["waitlist", "contact", "chat"]),
  email: z.string().email(),
});

const onboardingSchema = baseSchema.extend({
  type: z.literal("onboarding"),
  phone: z
    .string()
    .trim()
    .min(8)
    .max(20)
    .refine((value) => phoneRegex.test(normalizePhone(value)), {
      message: "Enter a valid mobile number.",
    }),
  journey: z.enum(["customer", "provider", "both"]),
});

const schema = z.discriminatedUnion("type", [contactSchema, onboardingSchema]);

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

function normalizePhone(value: string) {
  const cleaned = value.replace(/[^\d+]/g, "");
  const withSinglePlus = cleaned.startsWith("+")
    ? `+${cleaned.slice(1).replace(/\+/g, "")}`
    : cleaned.replace(/\+/g, "");

  // Convert SA local format 0XXXXXXXXX → +27XXXXXXXXX
  if (/^0\d{9}$/.test(withSinglePlus)) {
    return `+27${withSinglePlus.slice(1)}`;
  }

  return withSinglePlus;
}

const journeyPrefill: Record<string, string> = {
  customer: "Hi, I want to register as a customer and book services through Plug-A-Pro.",
  provider: "Hi, I want to join Plug-A-Pro as a service provider.",
  both: "Hi, I want to join Plug-A-Pro as both a customer and service provider.",
};

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
    .from("marketing_leads")
    .insert(
      result.data.type === "onboarding"
        ? {
            type: result.data.type,
            phone: normalizePhone(result.data.phone),
            journey: result.data.journey,
            message: result.data.message,
            source: result.data.source,
            venture: siteConfig.venture,
            whatsapp_opt_in: true,
          }
        : { ...result.data, venture: siteConfig.venture }
    );

  if (error) {
    console.error("[leads] insert error:", error.message);
    return NextResponse.json(
      { error: "Failed to save. Please try again." },
      { status: 500 }
    );
  }

  if (result.data.type === "onboarding") {
    return NextResponse.json({
      success: true,
      whatsappUrl: buildWhatsAppLink(journeyPrefill[result.data.journey]),
    });
  }

  return NextResponse.json({ success: true });
}
