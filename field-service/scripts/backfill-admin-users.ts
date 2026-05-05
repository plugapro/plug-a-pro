/**
 * backfill-admin-users.ts
 *
 * Creates AdminUser rows for any Supabase users whose user_metadata.role is
 * 'admin' or 'owner' but who don't yet have a row in the admin_users table.
 *
 * Safe to run multiple times — existing rows are skipped.
 *
 * Usage:
 *   npx tsx scripts/backfill-admin-users.ts
 *
 * Requires:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   DATABASE_URL
 */

import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import { db } from '../lib/db'
import type { Role } from '@prisma/client'

const LEGACY_TO_ROLE: Record<string, Role> = {
  admin: 'ADMIN',
  owner: 'OWNER',
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceKey) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
    process.exit(1)
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  console.log('Fetching Supabase users with admin/owner role…')

  // Fetch all users — Supabase paginates at 1 000; iterate if needed
  let page = 1
  let total = 0
  let created = 0
  let skipped = 0

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) {
      console.error('Supabase listUsers error:', error.message)
      process.exit(1)
    }

    const eligible = data.users.filter((u) => {
      const role = u.user_metadata?.role as string | undefined
      return role === 'admin' || role === 'owner'
    })

    total += data.users.length

    for (const user of eligible) {
      const role = LEGACY_TO_ROLE[user.user_metadata.role as string]
      const email = user.email ?? ''
      const name = (user.user_metadata?.name as string | undefined) ?? email

      const existing = await db.adminUser.findFirst({
        where: { OR: [{ userId: user.id }, { email }] },
        select: { id: true },
      })

      if (existing) {
        console.log(`  skip  ${email} (already has AdminUser row)`)
        skipped++
        continue
      }

      await db.adminUser.create({
        data: {
          userId: user.id,
          email,
          name,
          role,
          active: true,
          acceptedAt: user.last_sign_in_at ? new Date(user.last_sign_in_at) : null,
        },
      })
      console.log(`  ✓ created  ${email}  →  ${role}`)
      created++
    }

    if (data.users.length < 1000) break
    page++
  }

  console.log(`\nDone. Scanned ${total} users; created ${created}; skipped ${skipped}.`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
