import 'dotenv/config'

import { db as prisma } from '../lib/db'

const PLUMBING_TAG = 'plumbing'

async function main() {
  const strict = await prisma.providerApplication.findMany({
    where: { status: 'PENDING', skills: { has: PLUMBING_TAG } },
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      skills: true,
      serviceAreas: true,
      submittedAt: true,
      isTestUser: true,
    },
    orderBy: { submittedAt: 'asc' },
  })
  console.log(`\n[strict] PENDING + skills has '${PLUMBING_TAG}': ${strict.length}`)
  for (const row of strict) {
    console.log(`  ${row.submittedAt.toISOString()}  ${row.name}  ${row.phone}  skills=[${row.skills.join(',')}]  test=${row.isTestUser}`)
  }

  const queue = await prisma.providerApplication.findMany({
    where: { status: { in: ['PENDING', 'MORE_INFO_REQUIRED'] } },
    select: {
      id: true,
      name: true,
      phone: true,
      skills: true,
      status: true,
      submittedAt: true,
      isTestUser: true,
    },
    orderBy: { submittedAt: 'asc' },
  })
  console.log(`\n[queue] PENDING + MORE_INFO_REQUIRED, any skill: ${queue.length}`)
  for (const row of queue) {
    console.log(`  ${row.status.padEnd(20)} ${row.submittedAt.toISOString()}  ${row.name}  ${row.phone}  skills=[${row.skills.join(',')}]  test=${row.isTestUser}`)
  }

  const all = await prisma.providerApplication.findMany({ select: { skills: true } })
  const counts = new Map<string, number>()
  for (const row of all) for (const skill of row.skills) counts.set(skill, (counts.get(skill) ?? 0) + 1)
  console.log(`\n[slugs] distinct skill slugs across ${all.length} applications:`)
  for (const [slug, count] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(4)}  ${slug}`)
  }

  const approvedPlumbers = await prisma.provider.count({
    where: { skills: { has: PLUMBING_TAG }, active: true },
  })
  console.log(`\n[context] active providers with skill '${PLUMBING_TAG}': ${approvedPlumbers}`)
}

main()
  .catch((error) => {
    console.error('[list-pending-plumber-applications] failed', error)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
