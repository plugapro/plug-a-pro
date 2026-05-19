import { db } from '@/lib/db'

async function main() {
  const key = process.argv[2]
  const enabled = process.argv[3] !== 'false'
  if (!key) {
    console.error('Usage: pnpm exec tsx scripts/flip-flag.ts <key> [true|false]')
    process.exit(1)
  }
  const updated = await db.featureFlag.upsert({
    where: { key },
    create: { key, enabled, description: '' },
    update: { enabled },
  })
  console.log('Updated:', updated)
  await db.$disconnect()
}

main().catch((err) => { console.error(err); process.exit(1) })
