// Duck-type extraction of an error message from an `unknown` value, so we can
// classify recovery send failures (e.g. detect the [TEMPLATE_NOT_APPROVED]
// prefix from whatsapp.ts) without relying on `instanceof Error`. The latter
// failed in production on 2026-06-06 — a real Error thrown by sendTemplate
// surfaced as `recovery_failed` instead of `recovery_template_not_approved`,
// most likely because Turbopack-bundled code and the module that owns the
// Error class identity ended up on different copies of the global.
export function readRecoveryErrorMessage(value: unknown): string | null {
  if (typeof value === 'string') {
    return value.length > 0 ? value : null
  }
  if (value && typeof value === 'object' && 'message' in value) {
    const message = (value as { message: unknown }).message
    if (typeof message === 'string' && message.length > 0) return message
  }
  return null
}
