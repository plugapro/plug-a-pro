import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

async function main() {
  const result = await db.provider.updateMany({
    where: { phone: '+27823035070' },
    data: { isTestUser: true },
  })
  console.log(`Updated ${result.count} provider(s) — Lovemore isTestUser set to true`)
  await db.$disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
