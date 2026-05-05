// Run once after deploying WS-E.
// Reads the list of current admins from whatever provisions them today
// (env var, hardcoded list, existing table) and creates AdminUser rows so
// they can sign in via the new UI-backed mechanism.
//
// This script is IDEMPOTENT — safe to re-run.
//
// Usage:
//   npx tsx scripts/backfill-admin-users.ts

import { PrismaClient, Role } from '@prisma/client';

const db = new PrismaClient();

/**
 * Replace this with however admins are currently provisioned.
 *
 * Common patterns:
 *   1. Comma-separated env var:     ADMIN_EMAILS=alice@x.com,bob@y.com
 *   2. JSON env var:                ADMIN_USERS=[{"email":"..","name":"..","roles":[".."]}]
 *   3. Hardcoded in config file:    import adminSeed from '@/config/admins';
 *   4. Existing Postgres table:     read from `legacy_admins` and map.
 *
 * The example below handles options 1 and 2.
 */
function readSeedAdmins(): Array<{ email: string; name: string; roles: Role[] }> {
  const env = process.env.ADMIN_USERS;
  if (env) {
    try {
      const parsed = JSON.parse(env);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      console.warn('ADMIN_USERS is not valid JSON, falling through.');
    }
  }

  const emails = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean);

  return emails.map((email) => ({
    email,
    name: email.split('@')[0],
    roles: ['ADMIN'] as Role[],
  }));
}

async function main() {
  const seed = readSeedAdmins();
  if (seed.length === 0) {
    console.log('No admin seed data found. Nothing to backfill.');
    return;
  }

  let created = 0;
  let skipped = 0;

  for (const entry of seed) {
    const existing = await db.adminUser.findUnique({ where: { email: entry.email } });
    if (existing) {
      skipped += 1;
      continue;
    }
    await db.adminUser.create({
      data: {
        email: entry.email,
        name: entry.name,
        roles: entry.roles,
        isActive: true,
      },
    });
    created += 1;
  }

  console.log(`Backfill complete: ${created} created, ${skipped} already existed.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
