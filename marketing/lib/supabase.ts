// lib/supabase.ts
// SERVER-ONLY. Never import this from client components.
// Uses service role key - never exposed to the browser.
import "server-only";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

if (!url || !key) {
  // Warn at startup rather than throw - throwing at module load time crashes
  // `next build` in environments where env vars are not yet set (CI, preview deploys).
  // API routes that call supabase.from() will fail at request time with a clear error.
  // TODO: Copy .env.local.example to .env.local and fill in Supabase values.
  console.warn(
    "[supabase] NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set. " +
    "Lead capture and chat routes will fail at runtime until env vars are configured."
  );
}

export const supabase = createClient(url || "http://localhost", key || "placeholder", {
  auth: { persistSession: false },
});
