import { PrismaClient } from '@prisma/client'
import { auditLocationReferenceData } from '../lib/location-audit'

async function main() {
  const prisma = new PrismaClient()
  try {
    const audit = await auditLocationReferenceData(prisma)
    console.log(JSON.stringify(audit, null, 2))
    if (!audit.ok) throw new Error(`Location audit failed: ${audit.failures.join('; ')}`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error('[audit:locations] failed', error)
  process.exit(1)
})
