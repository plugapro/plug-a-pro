// lib/channel.ts — request channel resolution (VodaPay mini-program vs. plain web)
//
// The `pap_channel` cookie is set by POST /api/channel (flag-gated by
// channel.vodapay.v1) when a customer enters through the VodaPay mini-program
// WebView. Its presence/value drives VodaPay-mode UI (WhatsApp CTAs hidden,
// VodaPay federated login) without duplicating routes per channel.
//
// `server-only` and `next/headers` are aliased to test shims in
// vitest.config.ts (see __mocks__/server-only.ts, __mocks__/next-headers.ts),
// matching the pattern used by lib/payments.ts and friends — so this module
// can be imported directly from tests.
import 'server-only'
import { cookies } from 'next/headers'

export const CHANNEL_COOKIE = 'pap_channel'
export type RequestChannel = 'vodapay' | 'web'

export function parseChannelCookie(value: string | undefined): RequestChannel {
  return value === 'vodapay' ? 'vodapay' : 'web'
}

export async function getRequestChannel(): Promise<RequestChannel> {
  const jar = await cookies()
  return parseChannelCookie(jar.get(CHANNEL_COOKIE)?.value)
}
