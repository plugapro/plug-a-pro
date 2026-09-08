import 'server-only'
import { createHash } from 'crypto'
import { db as realDb } from '@/lib/db'

/** Value stored in CustomerExternalIdentity.provider for VodaPay mini-program users. */
export const VODAPAY_IDENTITY_PROVIDER = 'VODAPAY'

/**
 * Domain used to derive the deterministic, non-deliverable address that carries the
 * Supabase auth user for a VodaPay customer. supabase-js 2.106 can only mint a
 * session server-side through `admin.generateLink({ type: 'magiclink' })`, and every
 * variant of GenerateLinkParams requires an `email` — so a phone-only auth user has
 * no server-side session path. The address never receives mail: the user is created
 * with `email_confirm: true` and `generateLink` only *generates* a link, it does not
 * send one.
 */
export const VODAPAY_AUTH_EMAIL_DOMAIN = 'vodapay.users.plugapro.co.za'

/** Name persisted when VodaPay does not return one — Customer.name is required. */
export const VODAPAY_CUSTOMER_NAME_FALLBACK = 'VodaPay Customer'

type Db = typeof realDb

export async function resolveVodapayCustomer(
  deps: { db?: Db },
  input: { externalId: string; phone: string; fullName?: string },
): Promise<{ customerId: string; created: boolean }> {
  const db = deps.db ?? realDb

  const existing = await db.customerExternalIdentity.findUnique({
    where: {
      provider_externalId: {
        provider: VODAPAY_IDENTITY_PROVIDER,
        externalId: input.externalId,
      },
    },
    select: { customerId: true },
  })
  if (existing) return { customerId: existing.customerId, created: false }

  const byPhone = await db.customer.findFirst({
    where: { phone: input.phone },
    select: { id: true },
  })
  if (byPhone) {
    await db.customerExternalIdentity.create({
      data: {
        customerId: byPhone.id,
        provider: VODAPAY_IDENTITY_PROVIDER,
        externalId: input.externalId,
      },
    })
    return { customerId: byPhone.id, created: false }
  }

  const created = await db.customer.create({
    data: {
      phone: input.phone,
      name: input.fullName?.trim() || VODAPAY_CUSTOMER_NAME_FALLBACK,
      channel: 'PWA',
    },
    select: { id: true },
  })
  await db.customerExternalIdentity.create({
    data: {
      customerId: created.id,
      provider: VODAPAY_IDENTITY_PROVIDER,
      externalId: input.externalId,
    },
  })
  return { customerId: created.id, created: true }
}

/**
 * Deterministic, non-deliverable auth address for a VodaPay user. Hashed so the
 * host-issued customer id is neither leaked nor able to produce an invalid local
 * part (length or charset).
 */
export function vodapayAuthEmail(externalId: string): string {
  const digest = createHash('sha256').update(externalId).digest('hex').slice(0, 32)
  return `vodapay-${digest}@${VODAPAY_AUTH_EMAIL_DOMAIN}`
}

type SupabaseAuthUserRecord = {
  id: string
  email?: string | null
}

type VodapayAuthAdminClient = {
  auth: {
    admin: {
      createUser: (attributes: {
        phone: string
        phone_confirm: true
        email: string
        email_confirm: true
        user_metadata: Record<string, unknown>
      }) => Promise<{
        data: { user: SupabaseAuthUserRecord | null } | null
        error: unknown
      }>
      updateUserById: (
        uid: string,
        attributes: { email: string; email_confirm: true },
      ) => Promise<{
        data: { user: SupabaseAuthUserRecord | null } | null
        error: unknown
      }>
    }
  }
}

type AuthLookupClient = {
  $queryRaw: <T = unknown>(query: TemplateStringsArray, ...values: unknown[]) => Promise<T>
}

type AuthUserRow = {
  id: string
  email: string | null
  raw_user_meta_data: unknown
}

export type VodapayAuthUser = {
  userId: string
  /** Address to pass to `admin.generateLink({ type: 'magiclink' })`. */
  email: string
  source: 'created' | 'existing'
  /**
   * `user_metadata.role` already on the account, if any. Lets the caller refuse to
   * mint a session for a staff account off a third-party phone assertion.
   */
  metadataRole: string | null
}

// Supabase stores phones without the leading '+' (same normalisation as
// lib/provider-approval-auth-user.ts).
function supabaseAuthPhone(phone: string) {
  return phone.startsWith('+') ? phone.slice(1) : phone
}

function errorField(error: unknown, field: 'code' | 'message') {
  if (!error || typeof error !== 'object' || !(field in error)) return null
  const value = (error as Record<string, unknown>)[field]
  return typeof value === 'string' || typeof value === 'number' ? String(value) : null
}

function isPhoneExistsError(error: unknown) {
  const code = errorField(error, 'code')?.toLowerCase()
  const message = errorField(error, 'message')?.toLowerCase() ?? ''
  return code === 'phone_exists' || message.includes('phone number already registered')
}

function metadataRoleOf(rawUserMetaData: unknown): string | null {
  if (!rawUserMetaData || typeof rawUserMetaData !== 'object') return null
  const role = (rawUserMetaData as Record<string, unknown>).role
  return typeof role === 'string' && role.trim() ? role.trim().toLowerCase() : null
}

async function findExistingAuthUserByPhone(db: AuthLookupClient, phone: string) {
  const authPhone = supabaseAuthPhone(phone)
  const rows = await db.$queryRaw<AuthUserRow[]>`
    select id, email, raw_user_meta_data
    from auth.users
    where phone in (${authPhone}, ${phone})
    order by
      case when phone = ${authPhone} then 0 else 1 end,
      updated_at desc
    limit 1
  `

  return rows[0] ?? null
}

/**
 * Resolve (or create) the Supabase auth user behind a VodaPay-verified phone number
 * and guarantee it carries an email address, which is what the installed SDK's only
 * server-side session-mint path (`admin.generateLink`) requires.
 *
 * An existing user's real email is never replaced — it is returned as-is and used
 * for the magic-link mint. The derived VodaPay address is only attached when the
 * user has none.
 */
export async function resolveVodapayAuthUser(
  deps: { admin: VodapayAuthAdminClient; db?: AuthLookupClient },
  input: { externalId: string; phone: string; fullName?: string },
): Promise<VodapayAuthUser> {
  const db = deps.db ?? (realDb as unknown as AuthLookupClient)
  const authPhone = supabaseAuthPhone(input.phone)
  const derivedEmail = vodapayAuthEmail(input.externalId)

  const { data, error } = await deps.admin.auth.admin.createUser({
    phone: authPhone,
    phone_confirm: true,
    email: derivedEmail,
    email_confirm: true,
    user_metadata: {
      role: 'customer',
      channel: 'vodapay',
      ...(input.fullName?.trim() ? { name: input.fullName.trim() } : {}),
    },
  })

  if (!error && data?.user) {
    return { userId: data.user.id, email: derivedEmail, source: 'created', metadataRole: 'customer' }
  }

  if (!isPhoneExistsError(error)) {
    throw new Error('Supabase user creation failed')
  }

  const existing = await findExistingAuthUserByPhone(db, input.phone)
  if (!existing?.id) {
    throw new Error('Supabase user lookup failed')
  }

  const metadataRole = metadataRoleOf(existing.raw_user_meta_data)
  const existingEmail = existing.email?.trim()
  if (existingEmail) {
    return { userId: existing.id, email: existingEmail, source: 'existing', metadataRole }
  }

  const updated = await deps.admin.auth.admin.updateUserById(existing.id, {
    email: derivedEmail,
    email_confirm: true,
  })
  if (updated.error) {
    throw new Error('Supabase user email attach failed')
  }

  return { userId: existing.id, email: derivedEmail, source: 'existing', metadataRole }
}
