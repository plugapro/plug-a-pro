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
import { recordAuditLog } from '@/lib/audit'
import { createServiceClient } from '@/lib/auth'
import { resolveSessionMaxAge, SESSION_COOKIE_NAME } from '@/lib/auth-session-cookie'
import { issueAuthSessionWithSecurityGate } from '@/lib/auth-session-gate'
import { db } from '@/lib/db'
import { isEnabled } from '@/lib/flags'
import { checkVodapayAuthLimit } from '@/lib/rate-limit'
import { trustedClientIp } from '@/lib/request-ip'
import { normalizePhone } from '@/lib/utils'
import { applyToken, inquiryUserInfo, VodapayApiError } from '@/lib/vodapay/client'
import {
  findVodapayAuthUserByPhone,
  resolveVodapayAuthUser,
  resolveVodapayCustomer,
} from '@/lib/vodapay/identity'

const E164 = /^\+[1-9]\d{7,14}$/

// user_metadata.role values that must never be handed a session off a third-party
// phone assertion. getSession() already downgrades a forged metadata role, so this
// is defence in depth on top of the AdminUser lookup below.
const BLOCKED_METADATA_ROLES = new Set(['admin', 'owner'])

const SOURCE_ROUTE = '/api/auth/vodapay' as const

function jsonError(error: string, status: number) {
  const res = NextResponse.json({ error }, { status })
  res.headers.set('Cache-Control', 'no-store')
  return res
}

function clearSessionCookieHeader(): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  return `${SESSION_COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`
}

async function auditRefusal(params: {
  phone: string
  userId: string | null
  code: string
  detail?: Record<string, unknown>
}): Promise<void> {
  await recordAuditLog({
    actorId: params.userId ?? 'system',
    actorRole: params.userId ? 'customer' : 'system',
    action: 'auth.vodapay_session_refused',
    entityType: 'phone',
    entityId: params.phone,
    after: { source: SOURCE_ROUTE, code: params.code, ...params.detail },
  }).catch(() => undefined)
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

    // READ-ONLY first: every eligibility refusal below must happen before anything
    // is written, so a refused request never leaves a new auth user (or a derived
    // address attached to a staff/provider account) behind.
    const existingAuthUser = await findVodapayAuthUserByPhone({ db }, phone)

    // Staff and provider accounts are out of scope for the customer mini-program.
    // Refusing here also preserves the invariant in lib/auth.ts#linkCustomerAccount:
    // a provider-only account must never be auto-given a Customer record.
    if (
      existingAuthUser?.metadataRole &&
      BLOCKED_METADATA_ROLES.has(existingAuthUser.metadataRole)
    ) {
      await auditRefusal({
        phone,
        userId: existingAuthUser.userId,
        code: 'blocked_metadata_role',
      })
      return jsonError('account_not_eligible', 403)
    }

    const [staffRow, providerRow] = await Promise.all([
      // Same predicate proxy.ts uses to grant /admin (userId OR email), so an
      // invited-but-not-yet-accepted admin row is caught too.
      existingAuthUser
        ? db.adminUser.findFirst({
            where: {
              OR: [
                { userId: existingAuthUser.userId },
                ...(existingAuthUser.email ? [{ email: existingAuthUser.email }] : []),
              ],
            },
            select: { id: true },
          })
        : null,
      db.provider.findFirst({
        where: existingAuthUser
          ? { OR: [{ userId: existingAuthUser.userId }, { phone }] }
          : { phone },
        select: { id: true },
      }),
    ])
    if (staffRow || providerRow) {
      await auditRefusal({
        phone,
        userId: existingAuthUser?.userId ?? null,
        code: staffRow ? 'staff_account' : 'provider_account',
      })
      return jsonError('account_not_eligible', 403)
    }

    // Guards passed — writes start here.
    const authUser = await resolveVodapayAuthUser(
      { admin, db },
      { externalId, phone, fullName, existing: existingAuthUser },
    )
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

    // Same lockout / step-up gate every other session-issuing route runs through.
    // Applied unconditionally here (no flag): a federated login carries no OTP
    // challenge of its own, so this gate is the only thing standing between a
    // SIM-swap-style takeover of the VodaPay-side number and a live session on a
    // locked account. It also fails closed if the security state store is slow,
    // and writes the audit trail for the issuance.
    const gated = await issueAuthSessionWithSecurityGate({
      accessToken: verified.session.access_token,
      phoneE164: phone,
      userId: authUser.userId,
      maxAge: resolveSessionMaxAge(verified.session.expires_in),
      sourceRoute: SOURCE_ROUTE,
    })

    if (!gated.ok && gated.reason === 'LOCKED') {
      await auditRefusal({
        phone,
        userId: authUser.userId,
        code: gated.metadata?.code ?? 'ACCOUNT_LOCKED',
      })
      const res = NextResponse.json(
        { locked: true, code: gated.metadata?.code ?? 'ACCOUNT_LOCKED' },
        { status: 423 },
      )
      res.headers.set('Set-Cookie', clearSessionCookieHeader())
      res.headers.set('Cache-Control', 'no-store')
      return res
    }

    if (!gated.ok && gated.reason === 'STEP_UP_REQUIRED') {
      await auditRefusal({ phone, userId: authUser.userId, code: 'STEP_UP_REQUIRED' })
      const res = NextResponse.json({
        stepUpRequired: true,
        redirectTo: '/security/checkpoint',
      })
      res.headers.set('Set-Cookie', clearSessionCookieHeader())
      res.headers.append('Set-Cookie', gated.pendingStepUpCookie)
      res.headers.set('Cache-Control', 'no-store')
      return res
    }

    await recordAuditLog({
      actorId: authUser.userId,
      actorRole: 'customer',
      action: 'auth.vodapay_session_issued',
      entityType: 'phone',
      entityId: phone,
      after: {
        source: SOURCE_ROUTE,
        customerId,
        authUserSource: authUser.source,
      },
    }).catch(() => undefined)

    const res = NextResponse.json({ ok: true })
    res.headers.set('Set-Cookie', gated.setCookie)
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
