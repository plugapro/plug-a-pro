import { isIP } from 'node:net'
import type { NextRequest } from 'next/server'

function ipv4Bytes(value: string): [number, number, number, number] | null {
  if (isIP(value) !== 4) return null

  const parts = value.split('.').map((part) => Number.parseInt(part, 10))
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return null
  }

  const [a, b, c, d] = parts
  return [a, b, c, d]
}

function isGlobalIpv4(value: string): boolean {
  const bytes = ipv4Bytes(value)
  if (!bytes) return false

  const [a, b, c] = bytes

  // Reject RFC1918, loopback, link-local, documentation, benchmark, multicast,
  // and other special-use IPv4 ranges before treating a proxy value as public.
  if (a === 0) return false
  if (a === 10) return false
  if (a === 100 && b >= 64 && b <= 127) return false
  if (a === 127) return false
  if (a === 169 && b === 254) return false
  if (a === 172 && b >= 16 && b <= 31) return false
  if (a === 192 && b === 0 && c === 0) return false
  if (a === 192 && b === 0 && c === 2) return false
  if (a === 192 && b === 88 && c === 99) return false
  if (a === 192 && b === 168) return false
  if (a === 198 && (b === 18 || b === 19)) return false
  if (a === 198 && b === 51 && c === 100) return false
  if (a === 203 && b === 0 && c === 113) return false
  if (a >= 224) return false

  return true
}

function hexGroupToBytes(value: string): [number, number] | null {
  if (!/^[0-9a-f]{1,4}$/i.test(value)) return null

  const parsed = Number.parseInt(value, 16)
  return [parsed >> 8, parsed & 0xff]
}

function normalizeIpv4MappedAddress(value: string): string | null {
  const lower = value.toLowerCase()
  const mappedPrefix = lower.startsWith('::ffff:')
    ? '::ffff:'
    : lower.startsWith('0:0:0:0:0:ffff:')
      ? '0:0:0:0:0:ffff:'
      : null

  if (!mappedPrefix) return null

  const suffix = value.slice(mappedPrefix.length)
  if (isIP(suffix) === 4) return suffix

  const groups = suffix.split(':')
  if (groups.length !== 2) return null

  const high = hexGroupToBytes(groups[0])
  const low = hexGroupToBytes(groups[1])
  if (!high || !low) return null

  return [...high, ...low].join('.')
}

function ipv6Groups(value: string): number[] | null {
  if (isIP(value) !== 6 || value.includes('.')) return null

  const sections = value.toLowerCase().split('::')
  if (sections.length > 2) return null

  const parseSection = (section: string): number[] | null => {
    if (!section) return []

    return section.split(':').map((group) => {
      if (!/^[0-9a-f]{1,4}$/.test(group)) return Number.NaN
      return Number.parseInt(group, 16)
    })
  }

  const head = parseSection(sections[0])
  const tail = parseSection(sections[1] ?? '')
  if (!head || !tail || head.some(Number.isNaN) || tail.some(Number.isNaN)) {
    return null
  }

  if (sections.length === 1) {
    return head.length === 8 ? head : null
  }

  const missingGroups = 8 - head.length - tail.length
  if (missingGroups < 1) return null

  return [...head, ...Array<number>(missingGroups).fill(0), ...tail]
}

function isGlobalIpv6(value: string): boolean {
  const groups = ipv6Groups(value)
  if (!groups) return false

  // Reject local, documentation, multicast, and other non-global IPv6 ranges.
  if (groups.every((group) => group === 0)) return false
  if (groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1) {
    return false
  }
  if ((groups[0] & 0xfe00) === 0xfc00) return false
  if ((groups[0] & 0xffc0) === 0xfe80) return false
  if ((groups[0] & 0xff00) === 0xff00) return false
  if (groups[0] === 0x0100 && groups[1] === 0 && groups[2] === 0 && groups[3] === 0) {
    return false
  }
  if (groups[0] === 0x2001 && groups[1] === 0) return false
  if (groups[0] === 0x2001 && groups[1] === 0x0db8) return false
  if (groups[0] === 0x2002) return false

  return true
}

function normalizePublicIp(value: string): string | null {
  const ip = value.trim()
  if (!ip) return null

  const mappedIpv4 = normalizeIpv4MappedAddress(ip)
  if (mappedIpv4) return isGlobalIpv4(mappedIpv4) ? mappedIpv4 : null

  if (isGlobalIpv4(ip)) return ip
  if (isGlobalIpv6(ip)) return ip

  return null
}

export function trustedClientIpFromHeaders(headers: Pick<Headers, 'get'>): string | null {
  const forwarded = headers.get('x-forwarded-for')
  if (forwarded) {
    for (const part of forwarded.split(',')) {
      const ip = normalizePublicIp(part)
      if (ip) return ip
    }
  }

  const realIp = headers.get('x-real-ip')?.trim()
  return realIp ? normalizePublicIp(realIp) : null
}

export function trustedClientIp(request: NextRequest | Request): string | null {
  return trustedClientIpFromHeaders(request.headers)
}
