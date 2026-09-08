// POST /api/auth/vodapay
// Federated login for the VodaPay mini-program. The WebView hands us the
// host-issued authCode; we exchange it for a VodaPay access token, read the
// verified mobile number, resolve (or create) the Plug A Pro customer, and mint a
// Supabase session so the rest of the PWA sees an ordinary signed-in customer.
//
// Body: { authCode: string }
// Returns: { ok: true } with the HttpOnly sb-access-token cookie set, or
//          404 (flag off) / 400 (no authCode) / 401 (VodaPay auth failed) /
//          403 (phone belongs to a staff or provider account) / 429 / 503 / 500.
//
// SESSION MINT: supabase-js 2.106.0 has no `auth.admin.createSession`, so the only
// server-side path to an access token is admin.generateLink({ type: 'magiclink' })
// followed by verifyOtp({ token_hash, type: 'magiclink' }) on the anon client.
// generateLink is email-only in this SDK (every GenerateLinkParams variant requires
// `email`), which is why lib/vodapay/identity.ts guarantees the auth user carries
// one. No email is ever delivered: the address is confirmed via the admin API and
// generateLink only *generates* the link.

import { type NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/auth'
import { buildSessionCookieHeader, resolveSessionMaxAge } from '@/lib/auth-session-cookie'
import { db } from '@/lib/db'
import { isEnabled } from '@/lib/flags'
import { checkVodapayAuthLimit } from '@/lib/rate-limit'
import { trustedClientIp } from '@/lib/request-ip'
import { normalizePhone } from '@/lib/utils'
import { applyToken, inquiryUserInfo, VodapayApiError } from '@/lib/vodapay/client'
import { resolveVodapayAuthUser, resolveVodapayCustomer } from '@/lib/vodapay/identity'

const E164 = /^\+[1-9]\d{7,14}$/

// user_metadata.role values that must never be handed a session off a third-party
// phone assertion. getSession() already downgrades a forged metadata role, so this
// is defence in depth on top of the AdminUser lookup below.
const BLOCKED_METADATA_ROLES = new Set(['admin', 'owner'])

function jsonError(error: string, status: number) {
  const res = NextResponse.json({ error }, { status })
  res.headers.set('Cache-Control', 'no-store')
  return res
}

export async function POST(request: NextRequest) {
  if (!(await isEnabled('channel.vodapay.v1'))) {
    return jsonError('not_available', 404)
  }

  const body = (await request.json().catch(() => null)) as { authCode?: unknown } | null
  if (typeof body?.authCode !== 'string' || !body.authCode.trim()) {
    return jsonError('auth_code_required', 400)
  }

  const rateCheck = await checkVodapayAuthLimit({ ip: trustedClientIp(request) })
  if (!rateCheck.ok) {
    return jsonError(
      rateCheck.code === 'limiter_unavailable' ? 'rate_limiter_unavailable' : 'rate_limited',
      rateCheck.code === 'limiter_unavailable' ? 503 : 429,
    )
  }

  try {
    const token = await applyToken(body.authCode.trim())
    const info = await inquiryUserInfo(token.accessToken)

    if (!info.mobileNumber) {
      return jsonError('phone_unavailable', 401)
    }
    const phone = normalizePhone(info.mobileNumber)
    if (!E164.test(phone)) {
      return jsonError('phone_unavailable', 401)
    }

    const externalId = token.customerId || info.userId
    if (!externalId) {
      return jsonError('vodapay_auth_failed', 401)
    }

    const fullName = info.userName?.fullName
    const admin = createServiceClient()
    const authUser = await resolveVodapayAuthUser({ admin, db }, { externalId, phone, fullName })

    // Staff and provider accounts are out of scope for the customer mini-program.
    // Refusing here also preserves the invariant in lib/auth.ts#linkCustomerAccount:
    // a provider-only account must never be auto-given a Customer record.
    if (authUser.metadataRole && BLOCKED_METADATA_ROLES.has(authUser.metadataRole)) {
      return jsonError('account_not_eligible', 403)
    }
    const [staffRow, providerRow] = await Promise.all([
      // Same predicate proxy.ts uses to grant /admin (userId OR email), so an
      // invited-but-not-yet-accepted admin row is caught too.
      db.adminUser.findFirst({
        where: { OR: [{ userId: authUser.userId }, { email: authUser.email }] },
        select: { id: true },
      }),
      db.provider.findFirst({
        where: { OR: [{ userId: authUser.userId }, { phone }] },
        select: { id: true },
      }),
    ])
    if (staffRow || providerRow) {
      return jsonError('account_not_eligible', 403)
    }

    const { customerId } = await resolveVodapayCustomer({}, { externalId, phone, fullName })

    const { data: link, error: linkError } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email: authUser.email,
    })
    if (linkError || !link?.properties?.hashed_token) {
      console.error('[vodapay auth] generateLink failed', linkError)
      return jsonError('session_mint_failed', 500)
    }

    const anon = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    )
    const { data: verified, error: verifyError } = await anon.auth.verifyOtp({
      token_hash: link.properties.hashed_token,
      type: 'magiclink',
    })
    if (verifyError || !verified?.session?.access_token) {
      console.error('[vodapay auth] verifyOtp failed', verifyError)
      return jsonError('session_mint_failed', 500)
    }

    await linkCustomerUserId(customerId, authUser.userId)

    const res = NextResponse.json({ ok: true })
    res.headers.set(
      'Set-Cookie',
      buildSessionCookieHeader(
        verified.session.access_token,
        resolveSessionMaxAge(verified.session.expires_in),
      ),
    )
    res.headers.set('Cache-Control', 'no-store')
    return res
  } catch (err) {
    if (err instanceof VodapayApiError) {
      return jsonError('vodapay_auth_failed', 401)
    }
    console.error('[vodapay auth]', err)
    return jsonError('internal', 500)
  }
}

/**
 * Attach the Supabase user to the customer record, but only when the record is
 * still unlinked. An existing, different userId is never overwritten — that would
 * silently move a customer's history onto another account — and Customer.userId is
 * unique, so a userId already held by another row is left alone too.
 */
async function linkCustomerUserId(customerId: string, userId: string): Promise<void> {
  const customer = await db.customer.findUnique({
    where: { id: customerId },
    select: { id: true, userId: true },
  })
  if (!customer) return

  if (customer.userId) {
    if (customer.userId !== userId) {
      console.warn('[vodapay auth] customer already linked to a different auth user', {
        customerId,
        existingUserId: customer.userId,
        resolvedUserId: userId,
      })
    }
    return
  }

  const holder = await db.customer.findUnique({ where: { userId }, select: { id: true } })
  if (holder) {
    // Unique constraint on Customer.userId: another record owns this auth user.
    console.warn('[vodapay auth] auth user already linked to another customer', {
      customerId,
      holderCustomerId: holder.id,
      resolvedUserId: userId,
    })
    return
  }

  await db.customer.update({ where: { id: customerId }, data: { userId } })
}
