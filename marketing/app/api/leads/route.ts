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

const leadMagnetSchema = baseSchema.extend({
  type: z.literal("lead_magnet"),
  phone: z
    .string()
    .trim()
    .min(8)
    .max(20)
    .refine((value) => phoneRegex.test(normalizePhone(value)), {
      message: "Enter a valid mobile number.",
    }),
  magnet: z.enum(["template-pack", "dispatch-checklist", "cashflow-tracker"]),
});

const schema = z.discriminatedUnion("type", [contactSchema, onboardingSchema, leadMagnetSchema]);

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
  customer: "Hi, I want to register as a customer and book services through Plug A Pro.",
  provider: "Hi, I want to join Plug A Pro as a service provider.",
  both: "Hi, I want to join Plug A Pro as both a customer and service provider.",
};

const magnetPrefill: Record<string, string> = {
  "template-pack": "Hi ServiceMen, I'd like the free WhatsApp template pack please.",
  "dispatch-checklist": "Hi ServiceMen, I'd like the free dispatch checklist please.",
  "cashflow-tracker": "Hi ServiceMen, I'd like the free cash flow tracker please.",
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

  const normalizedPhone =
    result.data.type === "onboarding"
      ? normalizePhone(result.data.phone)
      : undefined;

  const insertPayload =
    result.data.type === "onboarding"
      ? {
          type: result.data.type,
          phone: normalizedPhone,
          journey: result.data.journey,
          message: result.data.message,
          source: result.data.source,
          venture: siteConfig.venture,
          whatsapp_opt_in: true,
        }
      : result.data.type === "lead_magnet"
      ? {
          type: result.data.type,
          phone: normalizePhone(result.data.phone),
          name: result.data.name,
          source: result.data.source ?? `lead-magnet/${result.data.magnet}`,
          message: result.data.magnet,
          venture: siteConfig.venture,
          whatsapp_opt_in: true,
        }
      : { ...result.data, venture: siteConfig.venture };

  const { error } = await supabase
    .from("marketing_leads")
    .insert(insertPayload);

  if (error) {
    console.error("[leads] insert error:", error.message);
    return NextResponse.json(
      { error: "Failed to save. Please try again." },
      { status: 500 }
    );
  }

  if (result.data.type === "onboarding" && normalizedPhone) {
    const { error: intakeError } = await supabase
      .from("onboarding_intakes")
      .insert({
        source: "marketing",
        sourceRef: result.data.source ?? "website",
        journey: result.data.journey,
        phone: normalizedPhone,
        name: result.data.name,
        message: result.data.message,
        status: "NEW",
        whatsappOptIn: true,
        metadata: {
          venture: siteConfig.venture,
          source: result.data.source ?? null,
        },
      });

    if (intakeError) {
      console.error("[leads] onboarding intake insert error:", intakeError.message);
      return NextResponse.json(
        { error: "Saved your details, but failed to create the operational intake handoff." },
        { status: 500 }
      );
    }
  }

  if (result.data.type === "onboarding") {
    return NextResponse.json({
      success: true,
      whatsappUrl: buildWhatsAppLink(journeyPrefill[result.data.journey]),
    });
  }

  if (result.data.type === "lead_magnet") {
    return NextResponse.json({
      success: true,
      whatsappUrl: buildWhatsAppLink(magnetPrefill[result.data.magnet]),
    });
  }

  return NextResponse.json({ success: true });
}
