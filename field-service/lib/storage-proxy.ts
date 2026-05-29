// ─── Blob proxy URL helpers ───────────────────────────────────────────────────
// Vercel Blob URLs must never be returned directly to clients - they are publicly
// guessable once the token is known. All attachment access goes through the
// /api/attachments/[id] proxy route, which enforces session or token-based auth
// before serving the file.
//
// Usage:
//   import { getBlobProxyUrl } from '@/lib/storage-proxy'
//   return NextResponse.json({ url: getBlobProxyUrl(fileId) })

/**
 * Returns the server-proxied URL for an attachment by DB record ID.
 * Use this instead of returning raw Blob URLs in API responses or rendering
 * them directly in components.
 */
export function getBlobProxyUrl(fileId: string): string {
  return `/api/attachments/${fileId}`
}
