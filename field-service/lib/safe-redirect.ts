export function getSafeNextPath(
  candidate: string | null | undefined,
  fallback: string,
): string {
  if (!candidate) return fallback

  const trimmed = candidate.trim()
  if (!trimmed.startsWith('/')) return fallback
  if (trimmed.startsWith('//')) return fallback
  if (trimmed.includes('\\')) return fallback

  try {
    const url = new URL(trimmed, 'https://plugapro.local')
    if (url.origin !== 'https://plugapro.local') return fallback
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return fallback
  }
}
