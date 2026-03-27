// app/api/chat/route.ts
// Requires VERCEL_OIDC_TOKEN for AI Gateway (run: vercel link && vercel env pull).
import { convertToModelMessages, streamText, tool, UIMessage } from "ai";
import { z } from "zod";
import { buildChatSystemPrompt } from "@/lib/chat-context";
import { supabase } from "@/lib/supabase";
import { siteConfig } from "@/lib/metadata";

export const maxDuration = 30;

export async function POST(request: Request) {
  let messages: UIMessage[];
  try {
    const body = await request.json();
    if (!Array.isArray(body?.messages)) {
      return new Response(JSON.stringify({ error: "Invalid request." }), { status: 400 });
    }
    messages = body.messages as UIMessage[];
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON." }), { status: 400 });
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
          const { error } = await supabase.from("leads").insert({
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
