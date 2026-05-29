/**
 * CSRF / origin protection helper for state-changing API routes.
 *
 * Next.js App Router server actions already enforce same-origin via the Origin
 * header automatically. API routes under app/api/** do NOT get that protection,
 * so call verifyRequestOrigin() at the top of any POST/PUT/DELETE handler that
 * performs authenticated mutations.
 *
 * Webhook routes (inbound from third-party services) must NOT use this helper -
 * they send Origin: null or a vendor-controlled origin by design.
 */
export function verifyRequestOrigin(req: Request, allowedOrigins: string[]): boolean {
  const origin = req.headers.get('origin')
  const host = req.headers.get('host')
  // Non-browser callers (server-to-server, curl, etc.) don't send an Origin
  // header. Treat the absence as safe - CSRF attacks require a browser.
  if (!origin) return true
  try {
    const originHost = new URL(origin).host
    return originHost === host || allowedOrigins.some((o) => origin.startsWith(o))
  } catch {
    return false
  }
}
