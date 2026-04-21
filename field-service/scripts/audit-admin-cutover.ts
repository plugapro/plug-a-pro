/**
 * audit-admin-cutover.ts
 *
 * Reconciles legacy Supabase metadata admins against DB-backed AdminUser rows
 * so the metadata fallback can be removed safely once the report is clean.
 *
 * Usage:
 *   npx tsx scripts/audit-admin-cutover.ts
 */

import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import { db } from '../lib/db'

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const legacyAdmins = new Map<string, { userId: string; email: string; role: string }>()
  let page = 1

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw error

    for (const user of data.users) {
      const role = user.user_metadata?.role
      if ((role === 'admin' || role === 'owner') && user.email) {
        legacyAdmins.set(user.email.toLowerCase(), {
          userId: user.id,
          email: user.email,
          role,
        })
      }
    }

    if (data.users.length < 1000) break
    page += 1
  }

  const adminUsers = await db.adminUser.findMany({
    select: {
      id: true,
      userId: true,
      email: true,
      role: true,
      active: true,
    },
  })

  const missingInDb = [...legacyAdmins.values()].filter(
    (legacy) =>
      !adminUsers.some(
        (adminUser) =>
          adminUser.userId === legacy.userId || adminUser.email.toLowerCase() === legacy.email.toLowerCase(),
      ),
  )

  const inactiveButStillLegacyPrivileged = adminUsers.filter((adminUser) => {
    const legacy = legacyAdmins.get(adminUser.email.toLowerCase())
    return Boolean(legacy && !adminUser.active)
  })

  console.log('Legacy admins missing AdminUser rows:')
  if (missingInDb.length === 0) {
    console.log('  none')
  } else {
    for (const legacy of missingInDb) {
      console.log(`  ${legacy.email} (${legacy.role})`)
    }
  }

  console.log('\nInactive AdminUser rows still holding legacy metadata privilege:')
  if (inactiveButStillLegacyPrivileged.length === 0) {
    console.log('  none')
  } else {
    for (const adminUser of inactiveButStillLegacyPrivileged) {
      console.log(`  ${adminUser.email} (${adminUser.role})`)
    }
  }
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
