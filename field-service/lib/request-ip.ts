import { isIP } from 'node:net'
import type { NextRequest } from 'next/server'

const PRIVATE_IPV4_RANGES = [
  /^0\./,
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^192\.168\./,
]

const PRIVATE_IPV6_RANGES = [/^::1$/i, /^fc/i, /^fd/i, /^fe80:/i]

function isPublicIp(value: string): boolean {
  const ip = value.trim()
  if (!ip) return false

  if (PRIVATE_IPV4_RANGES.some((range) => range.test(ip))) return false
  if (PRIVATE_IPV6_RANGES.some((range) => range.test(ip))) return false

  return isIP(ip) !== 0
}

export function trustedClientIpFromHeaders(headers: Pick<Headers, 'get'>): string | null {
  const forwarded = headers.get('x-forwarded-for')
  if (forwarded) {
    for (const part of forwarded.split(',')) {
      const ip = part.trim()
      if (isPublicIp(ip)) return ip
    }
  }

  const realIp = headers.get('x-real-ip')?.trim()
  return realIp && isPublicIp(realIp) ? realIp : null
}

export function trustedClientIp(request: NextRequest | Request): string | null {
  return trustedClientIpFromHeaders(request.headers)
}
