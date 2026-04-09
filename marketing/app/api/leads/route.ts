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
  name: z.string().trim().min(2).max(120),
  phone: z
    .string()
    .trim()
    .min(8)
    .max(20)
    .refine((value) => phoneRegex.test(normalizePhone(value)), {
      message: "Enter a valid mobile number.",
    }),
  journey: z.enum(["customer", "provider", "both"]),
  city: z.string().trim().min(2).max(120),
  serviceCategory: z.string().trim().min(2).max(120),
  businessName: z.string().trim().max(120).optional(),
  whatsappOptIn: z.boolean().default(true),
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

  return withSinglePlus;
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
    .insert(
      result.data.type === "onboarding"
        ? {
            type: result.data.type,
            name: result.data.name,
            phone: normalizePhone(result.data.phone),
            journey: result.data.journey,
            city: result.data.city,
            service_category: result.data.serviceCategory,
            business_name: result.data.businessName,
            whatsapp_opt_in: result.data.whatsappOptIn,
            message: result.data.message,
            source: result.data.source,
            venture: siteConfig.venture,
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
    const whatsappSummary = [
      `Hi ${siteConfig.name}, I have completed self-registration.`,
      `Name: ${result.data.name}`,
      `Mobile: ${normalizePhone(result.data.phone)}`,
      `I am joining as: ${result.data.journey}`,
      `Area: ${result.data.city}`,
      `Service / need: ${result.data.serviceCategory}`,
      result.data.businessName ? `Business: ${result.data.businessName}` : null,
      result.data.message ? `Extra info: ${result.data.message}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    return NextResponse.json({
      success: true,
      whatsappUrl: buildWhatsAppLink(whatsappSummary),
    });
  }

  return NextResponse.json({ success: true });
}
