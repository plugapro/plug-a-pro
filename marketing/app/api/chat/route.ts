// app/api/chat/route.ts
// Requires VERCEL_OIDC_TOKEN for AI Gateway (run: vercel link && vercel env pull).
import { convertToModelMessages, streamText, tool, UIMessage } from "ai";
import { z } from "zod";
import { buildChatSystemPrompt } from "@/lib/chat-context";
import { supabase } from "@/lib/supabase";
import { siteConfig } from "@/lib/metadata";
import { checkMarketingLeadRateLimit } from "@/lib/rate-limit";

export const maxDuration = 30;

const MAX_CHAT_MESSAGES = 24;
const MAX_CHAT_BODY_BYTES = 64_000;

function jsonResponse(body: unknown, init: ResponseInit) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

function requestIp(request: Request) {
  return (
    request.headers.get("x-forwarded-for") ??
    request.headers.get("x-real-ip") ??
    "unknown"
  );
}

export async function POST(request: Request) {
  const contentLength = Number.parseInt(request.headers.get("content-length") ?? "0", 10);
  if (Number.isFinite(contentLength) && contentLength > MAX_CHAT_BODY_BYTES) {
    return jsonResponse({ error: "Request too large." }, { status: 413 });
  }

  const rateLimit = await checkMarketingLeadRateLimit(requestIp(request));
  if (!rateLimit.ok) {
    return jsonResponse(
      {
        error:
          rateLimit.code === "limiter_unavailable"
            ? "Chat is temporarily unavailable. Please try again shortly."
            : "Too many requests. Please try again shortly.",
      },
      {
        status: rateLimit.code === "limiter_unavailable" ? 503 : 429,
        headers: { "Retry-After": String(Math.ceil(rateLimit.retryAfterMs / 1000)) },
      },
    );
  }

  let messages: UIMessage[];
  try {
    const body = await request.json();
    if (!Array.isArray(body?.messages)) {
      return jsonResponse({ error: "Invalid request." }, { status: 400 });
    }
    if (body.messages.length > MAX_CHAT_MESSAGES) {
      return jsonResponse({ error: "Too many messages." }, { status: 400 });
    }
    messages = body.messages as UIMessage[];
  } catch {
    return jsonResponse({ error: "Invalid JSON." }, { status: 400 });
  }

  const systemPrompt = await buildChatSystemPrompt();

  const result = streamText({
    // AI Gateway route — model string "provider/model"
    // Requires VERCEL_OIDC_TOKEN (run: vercel link && vercel env pull)
    model: "anthropic/claude-haiku-4.5",
    system: systemPrompt,
    messages: await convertToModelMessages(messages),
    tools: {
      captureLead: tool({
        description: "Call when the visitor shares their email address.",
        inputSchema: z.object({ email: z.string().email() }),
        execute: async ({ email }) => {
          const { error } = await supabase.from("marketing_leads").insert({
            type: "chat",
            email,
            venture: siteConfig.venture,
            source: "chat-widget",
          });
          if (error) console.error("[chat] captureLead error:", error.message);
          return { captured: !error };
        },
      }),
    },
  });

  return result.toUIMessageStreamResponse();
}
