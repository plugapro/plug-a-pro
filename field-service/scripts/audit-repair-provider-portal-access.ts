/**
 * Audits approved provider applications for Worker Portal login readiness.
 *
 * Dry run:
 *   pnpm exec tsx scripts/audit-repair-provider-portal-access.ts
 *
 * Repair safe links:
 *   pnpm exec tsx scripts/audit-repair-provider-portal-access.ts --commit
 */
import 'dotenv/config'
import { db } from '../lib/db'
import { createServiceClient } from '../lib/auth'
import { normalizeOtpPhoneNumber } from '../lib/phone-normalization'
import { maskPhone } from '../lib/support-diagnostics'

const COMMIT = process.argv.includes('--commit')

type AuthUserSummary = {
  id: string
  phone: string | null
  user_metadata?: Record<string, unknown>
}

function normalisePhoneOrNull(phone: string | null | undefined) {
  if (!phone) return null
  const result = normalizeOtpPhoneNumber(phone)
  return result.ok ? result.e164 : null
}

async function loadAuthUsersByPhone() {
  const supabase = createServiceClient()
  const byPhone = new Map<string, AuthUserSummary[]>()

  for (let page = 1; ; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw error

    for (const user of data.users) {
      const phone = normalisePhoneOrNull(user.phone)
      if (!phone) continue
      const bucket = byPhone.get(phone) ?? []
      bucket.push({
        id: user.id,
        phone,
        user_metadata: user.user_metadata as Record<string, unknown>,
      })
      byPhone.set(phone, bucket)
    }

    if (data.users.length < 1000) break
  }

  return byPhone
}

async function main() {
  const authUsersByPhone = await loadAuthUsersByPhone()
  const applications = await db.providerApplication.findMany({
    where: { status: 'APPROVED' },
    orderBy: { submittedAt: 'asc' },
    select: {
      id: true,
      phone: true,
      providerId: true,
      status: true,
      provider: {
        select: {
          id: true,
          phone: true,
          userId: true,
          active: true,
          verified: true,
          status: true,
        },
      },
    },
  })

  const summary = {
    applications: applications.length,
    missingProvider: 0,
    missingAuthUser: 0,
    missingProviderLink: 0,
    missingProviderUserId: 0,
    metadataMissingRole: 0,
    duplicateAuthUsers: 0,
    repairedApplicationLinks: 0,
    repairedProviderUserIds: 0,
    repairedMetadata: 0,
  }

  const supabase = COMMIT ? createServiceClient() : null

  for (const application of applications) {
    const phone = normalisePhoneOrNull(application.phone)
    if (!phone) {
      console.warn('[portal-access-audit] approved application has invalid phone', {
        applicationId: application.id,
        phoneMasked: maskPhone(application.phone),
      })
      continue
    }

    const providers = await db.provider.findMany({
      where: { phone },
      select: {
        id: true,
        phone: true,
        userId: true,
        active: true,
        verified: true,
        status: true,
      },
    })
    const provider = application.provider ?? providers[0] ?? null
    const authUsers = authUsersByPhone.get(phone) ?? []
    const authUser = authUsers[0] ?? null

    if (!provider) summary.missingProvider += 1
    if (!authUser) summary.missingAuthUser += 1
    if (authUsers.length > 1) summary.duplicateAuthUsers += 1
    if (provider && application.providerId !== provider.id) summary.missingProviderLink += 1
    if (provider && authUser && provider.userId !== authUser.id) summary.missingProviderUserId += 1
    if (authUser && authUser.user_metadata?.role !== 'provider') summary.metadataMissingRole += 1

    console.log('[portal-access-audit] row', {
      applicationId: application.id,
      phoneMasked: maskPhone(phone),
      providerId: provider?.id ?? null,
      applicationProviderId: application.providerId,
      authUserId: authUser?.id ?? null,
      authUserCount: authUsers.length,
      providerStatus: provider?.status ?? null,
      providerActive: provider?.active ?? null,
      providerVerified: provider?.verified ?? null,
      providerUserId: provider?.userId ?? null,
      authRole: authUser?.user_metadata?.role ?? null,
    })

    if (!COMMIT || !provider) continue

    if (application.providerId !== provider.id) {
      await db.providerApplication.update({
        where: { id: application.id },
        data: { providerId: provider.id },
      })
      summary.repairedApplicationLinks += 1
    }

    if (authUser && provider.userId !== authUser.id) {
      await db.provider.update({
        where: { id: provider.id },
        data: { userId: authUser.id },
      })
      summary.repairedProviderUserIds += 1
    }

    if (authUser && supabase && authUser.user_metadata?.role !== 'provider') {
      await supabase.auth.admin.updateUserById(authUser.id, {
        user_metadata: {
          ...authUser.user_metadata,
          role: 'provider',
          providerId: provider.id,
        },
      })
      summary.repairedMetadata += 1
    }
  }

  console.log('[portal-access-audit] summary', {
    mode: COMMIT ? 'commit' : 'dry-run',
    ...summary,
  })
}

main()
  .catch((error) => {
    console.error('[portal-access-audit] failed', error)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
