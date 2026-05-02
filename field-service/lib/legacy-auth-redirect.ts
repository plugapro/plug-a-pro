export type LegacyAuthSearchParams = Record<string, string | string[] | undefined>

export function buildLegacyAuthRedirectPath(destination: '/provider-sign-in' | '/provider-verify', params: LegacyAuthSearchParams) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string') {
      search.append(key, value)
      continue
    }
    if (Array.isArray(value)) {
      for (const item of value) search.append(key, item)
    }
  }
  const queryString = search.toString()
  return `${destination}${queryString ? `?${queryString}` : ''}`
}
