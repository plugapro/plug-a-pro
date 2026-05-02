import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

async function main() {
  // 1. Outstanding job requests (OPEN or MATCHING — no accepted match yet)
  const outstanding = await db.jobRequest.findMany({
    where: {
      status: { in: ['OPEN', 'MATCHING', 'PENDING_VALIDATION'] },
    },
    include: {
      customer: { select: { name: true, phone: true } },
      leads: {
        select: { providerId: true, status: true, expiresAt: true, sentAt: true },
      },
    },
    orderBy: { createdAt: 'asc' },
  })

  console.log(`\n=== OUTSTANDING JOB REQUESTS (${outstanding.length}) ===`)
  for (const jr of outstanding) {
    const leadsTotal = jr.leads.length
    const leadsPending = jr.leads.filter(l => l.status === 'SENT').length
    const leadsDeclined = jr.leads.filter(l => l.status === 'DECLINED').length
    const leadsExpired = jr.leads.filter(l => l.status === 'EXPIRED').length
    console.log(`\nID: ${jr.id}`)
    console.log(`  Status: ${jr.status}`)
    console.log(`  Category: ${jr.category}`)
    console.log(`  Title: ${jr.title}`)
    console.log(`  Customer: ${jr.customer?.name ?? 'N/A'} (${jr.customer?.phone ?? 'N/A'})`)
    console.log(`  Created: ${jr.createdAt.toISOString()}`)
    console.log(`  Leads sent: ${leadsTotal} (pending=${leadsPending}, declined=${leadsDeclined}, expired=${leadsExpired})`)
  }

  // 2. OPEN requests with zero leads dispatched
  const noLeads = outstanding.filter(jr => jr.leads.length === 0)
  console.log(`\n=== OPEN WITH NO LEADS DISPATCHED (${noLeads.length}) ===`)
  for (const jr of noLeads) {
    console.log(`  ${jr.id} | ${jr.category} | ${jr.title}`)
  }

  // 3. Available, verified providers (could match)
  const availableProviders = await db.provider.findMany({
    where: {
      active: true,
      verified: true,
      status: 'ACTIVE',
      availableNow: true,
    },
    select: {
      id: true,
      name: true,
      phone: true,
      skills: true,
      serviceAreas: true,
      technicianSkills: { where: { active: true }, select: { skillTag: true } },
      technicianServiceAreas: {
        where: { active: true },
        select: { label: true, city: true, suburbKey: true, regionKey: true },
      },
    },
  })

  console.log(`\n=== AVAILABLE PROVIDERS (${availableProviders.length}) ===`)
  for (const p of availableProviders) {
    const skills = [
      ...p.skills,
      ...(p.technicianSkills ?? []).map(s => s.skillTag),
    ]
    const areas = [
      ...p.serviceAreas,
      ...(p.technicianServiceAreas ?? []).map(a => a.label ?? a.city ?? a.suburbKey ?? ''),
    ].filter(Boolean)
    console.log(`  ${p.name} (${p.phone}) | skills: ${[...new Set(skills)].join(', ')} | areas: ${[...new Set(areas)].join(', ')}`)
  }

  // 4. Cross-match: which open requests could be served by available providers?
  console.log(`\n=== POTENTIAL MATCHES ===`)
  for (const jr of outstanding) {
    const category = jr.category.toLowerCase()
    const matching = availableProviders.filter(p => {
      const skills = new Set([
        ...p.skills.map(s => s.toLowerCase()),
        ...(p.technicianSkills ?? []).map(s => s.skillTag.toLowerCase()),
      ])
      return skills.has(category)
    })
    if (matching.length > 0) {
      console.log(`\n  JobRequest ${jr.id} (${jr.category} | ${jr.title})`)
      console.log(`    Matching providers: ${matching.map(p => `${p.name} (${p.phone})`).join(', ')}`)
    }
  }

  await db.$disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
