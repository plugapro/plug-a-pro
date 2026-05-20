export const SESSION_COOKIE_NAME = 'sb-access-token'
export const DEFAULT_SESSION_MAX_AGE = 60 * 60
export const MAX_SESSION_MAX_AGE = 60 * 60 * 24

export function resolveSessionMaxAge(expiresIn: unknown): number {
  const requested =
    typeof expiresIn === 'number' && Number.isFinite(expiresIn)
      ? expiresIn
      : DEFAULT_SESSION_MAX_AGE

  return Math.min(
    MAX_SESSION_MAX_AGE,
    Math.max(DEFAULT_SESSION_MAX_AGE, Math.floor(requested)),
  )
}

export function buildSessionCookieHeader(token: string, maxAge: number): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  return `${SESSION_COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`
}
