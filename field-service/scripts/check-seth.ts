import { db } from '../lib/db'

const SETH_ID = 'e2ed5e6c-566f-4bbc-ab2a-1b34fa3eaba0'
const JR_ID   = 'cmocwm87n003xl704ecopkund'

async function main() {
  // 1. All assignment holds for Seth
  const holdCols = await db.$queryRaw`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'assignment_holds' ORDER BY ordinal_position
  ` as any[]
  console.log('assignment_holds cols:', holdCols.map((c: any) => c.column_name).join(', '))

  const holds = await db.$queryRaw`
    SELECT id, "jobRequestId", status::text, "expiresAt", "createdAt"
    FROM assignment_holds
    WHERE "providerId" = ${SETH_ID}
    ORDER BY "createdAt" DESC
    LIMIT 10
  ` as any[]
  console.log(`\nSeth's assignment holds (${holds.length}):`)
  for (const h of holds) {
    const expired = new Date(h.expiresAt) < new Date() ? '(EXPIRED)' : '(ACTIVE!)'
    console.log(`  [${h.id}]  job=${h.jobRequestId}  status=${h.status}  expires=${h.expiresAt}  ${expired}`)
  }

  // 2. providerCapacity
  const capCols = await db.$queryRaw`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'provider_capacity' ORDER BY ordinal_position
  ` as any[]
  console.log('\nprovider_capacity cols:', capCols.map((c: any) => c.column_name).join(', '))

  const cap = await db.$queryRaw`
    SELECT * FROM provider_capacity WHERE "providerId" = ${SETH_ID}
  ` as any[]
  console.log(`\nSeth capacity:`, cap.length ? JSON.stringify(cap[0]) : 'no row')

  // 3. Active leads for Seth
  const leads = await db.$queryRaw`
    SELECT id, "jobRequestId", status::text, "expiresAt"
    FROM leads
    WHERE "providerId" = ${SETH_ID}
    ORDER BY id DESC LIMIT 5
  ` as any[]
  console.log(`\nSeth's leads (${leads.length}):`)
  for (const l of leads) console.log(`  ${l.id}  job=${l.jobRequestId}  status=${l.status}  expires=${l.expiresAt}`)
}

main().catch(console.error).finally(() => db.$disconnect())
