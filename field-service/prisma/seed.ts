// ─── Seed — field-service marketplace schema ──────────────────────────────────
// Run: pnpm db:seed
//
// Creates a complete, demo-ready dataset:
//   • 4 customers across SA cities
//   • 10 providers spread across all 8 service categories
//   • 2 provider applications (1 PENDING, 1 APPROVED)
//   • 4 job requests in different statuses
//   • 1 full pipeline: match → quote → booking → completed job + review
//   • Conversation records per customer phone
//
// Safe to re-run — uses upsert / findFirst guards throughout.

import {
  PrismaClient,
  JobRequestStatus,
  MatchStatus,
  QuoteStatus,
  BookingStatus,
  JobStatus,
  ReviewerType,
  ApplicationStatus,
} from '@prisma/client'
import { randomBytes } from 'crypto'
import { seedLocationNodes } from '../lib/location-seed'

const prisma = new PrismaClient()

// ─── Service categories (must match JOB_CATEGORIES in job-request.ts) ─────────
// Plumbing | Painting | Garden & Landscaping | Handyman
// Appliances | Electrical | DIY & Assembly | Roofing

async function main() {
  // SECURITY (finding 981b2f79): this seed creates a demo-ready dataset including
  // verified fake providers and a quote with a hard-coded, publicly guessable
  // approvalToken ("seed-quote-token-001"). It must NEVER run against production.
  // Public quote endpoints look up quotes by approvalToken without authentication,
  // so seeding production would expose a guessable public quote/job and pollute
  // real data with fake verified providers.
  if (process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production') {
    throw new Error(
      'Seed script must not run in production. Refusing to seed demo data into a production database.',
    )
  }

  await seedLocationNodes(prisma)

  // ── Customers ────────────────────────────────────────────────────────────────
  const customerData = [
    {
      phone: '+27831000001',
      name:  'Zanele Khumalo',
      email: 'zanele.khumalo@example.co.za',
      address: { street: '12 Acacia Avenue', suburb: 'Sandton',    city: 'Johannesburg', province: 'Gauteng' },
    },
    {
      phone: '+27831000002',
      name:  'Lerato Molefe',
      email: 'lerato.molefe@example.co.za',
      address: { street: '7 Protea Road',    suburb: 'Claremont',  city: 'Cape Town',     province: 'Western Cape' },
    },
    {
      phone: '+27831000003',
      name:  'Siphamandla Dube',
      email: 'siphamandla.dube@example.co.za',
      address: { street: '3 Umgeni Road',    suburb: 'Morningside', city: 'Durban',        province: 'KwaZulu-Natal' },
    },
    {
      phone: '+27831000004',
      name:  'Boitumelo Sithole',
      email: 'boitumelo.sithole@example.co.za',
      address: { street: '21 Jacaranda Street', suburb: 'Arcadia', city: 'Pretoria',      province: 'Gauteng' },
    },
  ]

  const customers: Record<string, any> = {}
  const addresses: Record<string, any> = {}

  for (const c of customerData) {
    const customer = await prisma.customer.upsert({
      where:  { phone: c.phone },
      create: { phone: c.phone, name: c.name, email: c.email },
      update: { name: c.name },
    })
    customers[c.phone] = customer

    const existing = await prisma.address.findFirst({ where: { customerId: customer.id } })
    addresses[c.phone] = existing ?? await prisma.address.create({
      data: { customerId: customer.id, ...c.address },
    })
  }

  console.log(`✔ Customers: ${customerData.map((c) => c.name).join(', ')}`)

  // ── Providers — one or two per category, all 8 covered ────────────────────────
  // All 10 providers are in Gauteng, spread across 10 distinct regions.
  // Each provider's lat/lng is their home region centre — radius defines
  // how far they are willing to travel from that centre.
  const providerData = [
    // ── Plumbing — JHB North / Randburg
    {
      phone:        '+27711000001',
      name:         'Thabo Nkosi',
      skills:       ['Plumbing'],
      serviceAreas: ['Randburg', 'Northcliff', 'Florida', 'Linden', 'Greenside'],
      equipmentTags: ['plumbing-kit', 'pipe-threader'],
      vehicleTypes: ['bakkie'],
      lat: -26.0940, lng: 27.9997, radiusKm: 20,
    },
    // ── Electrical — Centurion / Midrand
    {
      phone:        '+27711000002',
      name:         'Kagiso Sithole',
      skills:       ['Electrical'],
      serviceAreas: ['Midrand', 'Centurion', 'Halfway House', 'Waterfall', 'Noordwyk'],
      equipmentTags: ['multimeter', 'cable-tester', 'ladder'],
      vehicleTypes: ['van'],
      lat: -25.9006, lng: 28.1277, radiusKm: 25,
    },
    // ── Painting — JHB South / Soweto
    {
      phone:        '+27711000003',
      name:         'Nomsa Dlamini',
      skills:       ['Painting'],
      serviceAreas: ['Soweto', 'Lenasia', 'Johannesburg South', 'Eldorado Park', 'Ennerdale'],
      equipmentTags: ['roller-set', 'spray-gun', 'scaffold'],
      vehicleTypes: ['van'],
      lat: -26.2674, lng: 27.8588, radiusKm: 20,
    },
    // ── Garden & Landscaping — East Rand / Kempton Park
    {
      phone:        '+27711000004',
      name:         'Sibusiso Mthembu',
      skills:       ['Garden & Landscaping'],
      serviceAreas: ['Kempton Park', 'Tembisa', 'Boksburg', 'Benoni', 'Isando'],
      equipmentTags: ['lawnmower', 'hedge-trimmer', 'chainsaw'],
      vehicleTypes: ['bakkie'],
      lat: -26.0991, lng: 28.2281, radiusKm: 22,
    },
    // ── Handyman (multi-skill) — Pretoria CBD
    {
      phone:        '+27711000005',
      name:         'Fatima Cassim',
      skills:       ['Handyman', 'Plumbing', 'Painting'],
      serviceAreas: ['Arcadia', 'Hatfield', 'Sunnyside', 'Brooklyn', 'Muckleneuk'],
      equipmentTags: ['basic-toolkit', 'drill', 'sander'],
      vehicleTypes: ['hatchback'],
      lat: -25.7462, lng: 28.1882, radiusKm: 15,
    },
    // ── Appliances — JHB East / Edenvale
    {
      phone:        '+27711000006',
      name:         'Bongani Zulu',
      skills:       ['Appliances'],
      serviceAreas: ['Edenvale', 'Bedfordview', 'Eastgate', 'Sandringham', 'Highlands North'],
      equipmentTags: ['appliance-toolkit', 'multimeter', 'soldering-iron'],
      vehicleTypes: ['sedan'],
      lat: -26.1310, lng: 28.1619, radiusKm: 18,
    },
    // ── DIY & Assembly — JHB CBD / Braamfontein
    {
      phone:        '+27711000007',
      name:         'Ayanda Mokoena',
      skills:       ['DIY & Assembly', 'Handyman'],
      serviceAreas: ['Johannesburg CBD', 'Braamfontein', 'Melville', 'Auckland Park', 'Westdene'],
      equipmentTags: ['power-drill', 'level', 'furniture-kit'],
      vehicleTypes: ['hatchback'],
      lat: -26.2041, lng: 28.0473, radiusKm: 15,
    },
    // ── Roofing — Pretoria East / Menlyn
    {
      phone:        '+27711000008',
      name:         'Petrus van Wyk',
      skills:       ['Roofing'],
      serviceAreas: ['Menlyn', 'Lynnwood', 'Garsfontein', 'Faerie Glen', 'Moreleta Park'],
      equipmentTags: ['roofing-nailer', 'safety-harness', 'scaffold'],
      vehicleTypes: ['bakkie'],
      lat: -25.7900, lng: 28.2766, radiusKm: 20,
    },
    // ── Electrical + DIY — Sandton / JHB North
    {
      phone:        '+27711000009',
      name:         'Thandeka Nxumalo',
      skills:       ['Electrical', 'DIY & Assembly'],
      serviceAreas: ['Sandton', 'Fourways', 'Bryanston', 'Rivonia', 'Morningside'],
      equipmentTags: ['multimeter', 'conduit-bender', 'power-drill'],
      vehicleTypes: ['van'],
      lat: -26.1076, lng: 28.0567, radiusKm: 20,
    },
    // ── Painting + Roofing — Pretoria North
    {
      phone:        '+27711000010',
      name:         'Musa Khumalo',
      skills:       ['Painting', 'Roofing'],
      serviceAreas: ['Pretoria North', 'Wonderboom', 'Akasia', 'Rosslyn', 'Soshanguve'],
      equipmentTags: ['roller-set', 'roofing-nailer', 'scaffold'],
      vehicleTypes: ['bakkie'],
      lat: -25.6714, lng: 28.1847, radiusKm: 20,
    },
  ]

  for (const p of providerData) {
    await prisma.provider.upsert({
      where:  { phone: p.phone },
      create: {
        phone:          p.phone,
        name:           p.name,
        skills:         p.skills,
        serviceAreas:   p.serviceAreas,
        equipmentTags:  p.equipmentTags,
        vehicleTypes:   p.vehicleTypes,
        active:         true,
        verified:       true,
        availableNow:   true,
        averageRating:  +(4.2 + Math.random() * 0.7).toFixed(1),
        reliabilityScore: +(0.80 + Math.random() * 0.15).toFixed(2),
        completedJobsCount: Math.floor(5 + Math.random() * 30),
        onTimeRate:     +(0.85 + Math.random() * 0.12).toFixed(2),
        acceptanceRate: +(0.80 + Math.random() * 0.18).toFixed(2),
      },
      update: { name: p.name, skills: p.skills, active: true, verified: true, availableNow: true },
    })
  }

  const providers = await Promise.all(
    providerData.map((p) => prisma.provider.findFirstOrThrow({ where: { phone: p.phone } }))
  )

  // Skills, service areas, schedules
  for (let i = 0; i < providers.length; i++) {
    const provider = providers[i]
    const p = providerData[i]

    await prisma.technicianSkill.deleteMany({ where: { providerId: provider.id } })
    await prisma.technicianServiceArea.deleteMany({ where: { providerId: provider.id } })
    await prisma.technicianAvailability.deleteMany({ where: { providerId: provider.id } })
    await prisma.providerSchedule.deleteMany({ where: { providerId: provider.id } })

    await prisma.technicianSkill.createMany({
      data: p.skills.map((skillTag) => ({ providerId: provider.id, skillTag, active: true })),
    })

    await prisma.technicianServiceArea.createMany({
      data: p.serviceAreas.map((label) => ({
        providerId: provider.id,
        label,
        areaType: 'SUBURB',
        active: true,
      })),
    })

    await prisma.technicianServiceArea.create({
      data: {
        providerId: provider.id,
        label:      `${provider.name} radius`,
        city:       p.serviceAreas[0] ?? null,
        areaType:   'RADIUS',
        lat:        p.lat,
        lng:        p.lng,
        radiusKm:   p.radiusKm,
        active:     true,
      },
    })

    await prisma.technicianAvailability.create({
      data: { providerId: provider.id, availabilityState: 'AVAILABLE' },
    })

    // Mon–Fri 07:00–17:00
    await prisma.providerSchedule.createMany({
      data: [1, 2, 3, 4, 5].map((day) => ({
        providerId: provider.id,
        dayOfWeek:  day,
        startTime:  '07:00',
        endTime:    '17:00',
      })),
    })
  }

  console.log(`✔ Providers (${providers.length}): ${providerData.map((p) => p.name).join(', ')}`)

  // ── Provider applications ─────────────────────────────────────────────────────
  const appData = [
    {
      phone:        '+27799000001',
      name:         'Dimpho Radebe',
      skills:       ['Garden & Landscaping', 'Handyman'],
      serviceAreas: ['Soweto', 'Orlando', 'Meadowlands'],
      status:       ApplicationStatus.PENDING,
    },
    {
      phone:        '+27799000002',
      name:         'Lebo Mahlangu',
      skills:       ['Appliances', 'DIY & Assembly'],
      serviceAreas: ['Centurion', 'Pretoria North'],
      status:       ApplicationStatus.APPROVED,
    },
  ]

  for (const app of appData) {
    const existing = await prisma.providerApplication.findFirst({ where: { phone: app.phone } })
    if (!existing) {
      await prisma.providerApplication.create({ data: app })
      console.log(`✔ ProviderApplication: ${app.name} (${app.status})`)
    }
  }

  // ── Job request 1: Full pipeline — Zanele, Plumbing, COMPLETED ────────────────
  const zanele = customers['+27831000001']
  const zaneleAddr = addresses['+27831000001']
  const thabo = providers[0] // Thabo Nkosi — Plumbing

  const existingCompleted = await prisma.job.findFirst({
    where: { status: JobStatus.COMPLETED, booking: { match: { jobRequest: { customerId: zanele.id } } } },
  })

  if (!existingCompleted) {
    const quoteApprovalToken = randomBytes(24).toString('hex')

    const jr1 = await prisma.jobRequest.create({
      data: {
        customerId:  zanele.id,
        addressId:   zaneleAddr.id,
        category:    'Plumbing',
        title:       'Leaking tap in kitchen',
        description: 'Kitchen cold-water tap has been dripping for a week. Needs washer replacement or full tap.',
        status:      JobRequestStatus.MATCHED,
      },
    })

    const match1 = await prisma.match.create({
      data: {
        jobRequestId:     jr1.id,
        providerId:       thabo.id,
        status:           MatchStatus.QUOTE_APPROVED,
        inspectionNeeded: false,
      },
    })

    const quote1 = await prisma.quote.create({
      data: {
        matchId:       match1.id,
        amount:        650,
        labourCost:    500,
        materialsCost: 150,
        description:   'Replace kitchen tap washers and re-seal. Includes call-out fee.',
        status:        QuoteStatus.APPROVED,
        approvalToken: quoteApprovalToken,
      },
    })

    const booking1 = await prisma.booking.create({
      data: {
        matchId:       match1.id,
        quoteId:       quote1.id,
        status:        BookingStatus.COMPLETED,
        scheduledDate: new Date('2026-04-10T09:00:00.000Z'),
      },
    })

    const job1 = await prisma.job.create({
      data: {
        bookingId:  booking1.id,
        providerId: thabo.id,
        status:     JobStatus.COMPLETED,
      },
    })

    await prisma.review.create({
      data: {
        jobId:        job1.id,
        reviewerType: ReviewerType.CUSTOMER,
        customerId:   zanele.id,
        score:        5,
        comment:      'Thabo was on time, professional, and fixed the issue cleanly. Will book again.',
      },
    })

    console.log('✔ Job pipeline 1: Zanele / Plumbing → COMPLETED + Review')
  }

  // ── Job request 2: Lerato, Electrical, OPEN ──────────────────────────────────
  const lerato = customers['+27831000002']
  const leratoAddr = addresses['+27831000002']

  const existingOpen = await prisma.jobRequest.findFirst({
    where: { customerId: lerato.id, category: 'Electrical' },
  })

  if (!existingOpen) {
    await prisma.jobRequest.create({
      data: {
        customerId:  lerato.id,
        addressId:   leratoAddr.id,
        category:    'Electrical',
        title:       'No power to lounge plug points',
        description: 'Three plug points in the lounge stopped working after load-shedding. Breaker trips when reset.',
        status:      JobRequestStatus.OPEN,
      },
    })
    console.log('✔ Job request 2: Lerato / Electrical → OPEN')
  }

  // ── Job request 3: Siphamandla, Garden & Landscaping, MATCHING ────────────────
  const siphamandla = customers['+27831000003']
  const siphamandlaAddr = addresses['+27831000003']

  const existingMatching = await prisma.jobRequest.findFirst({
    where: { customerId: siphamandla.id, category: 'Garden & Landscaping' },
  })

  if (!existingMatching) {
    await prisma.jobRequest.create({
      data: {
        customerId:  siphamandla.id,
        addressId:   siphamandlaAddr.id,
        category:    'Garden & Landscaping',
        title:       'Overgrown back garden — full clearance',
        description: 'Large back garden with overgrown lawn, hedges and tree branches overhanging the fence.',
        status:      JobRequestStatus.MATCHING,
      },
    })
    console.log('✔ Job request 3: Siphamandla / Garden & Landscaping → MATCHING')
  }

  // ── Job request 4: Boitumelo, Roofing, PENDING_VALIDATION ────────────────────
  const boitumelo = customers['+27831000004']
  const boitumeloAddr = addresses['+27831000004']

  const existingPending = await prisma.jobRequest.findFirst({
    where: { customerId: boitumelo.id, category: 'Roofing' },
  })

  if (!existingPending) {
    await prisma.jobRequest.create({
      data: {
        customerId:  boitumelo.id,
        addressId:   boitumeloAddr.id,
        category:    'Roofing',
        title:       'Roof leaking after recent storms',
        description: 'Water coming through ceiling in master bedroom after the last two rain storms.',
        status:      JobRequestStatus.PENDING_VALIDATION,
      },
    })
    console.log('✔ Job request 4: Boitumelo / Roofing → PENDING_VALIDATION')
  }

  // ── Conversations ─────────────────────────────────────────────────────────────
  const convExpiry = new Date(Date.now() + 48 * 60 * 60 * 1000)

  for (const c of customerData) {
    await prisma.conversation.upsert({
      where:  { phone: c.phone },
      create: { phone: c.phone, flow: 'job_request', step: 'welcome', data: {}, expiresAt: convExpiry },
      update: { expiresAt: convExpiry },
    })
  }

  console.log('✔ Conversations: 4 upserted')
  console.log('\n✅ Seed complete.')
  console.log('   Providers:    10 active + verified across all 8 categories')
  console.log('   Customers:    4 across Johannesburg, Cape Town, Durban, Pretoria')
  console.log('   Job requests: COMPLETED · OPEN · MATCHING · PENDING_VALIDATION')
  console.log('   Applications: 1 PENDING · 1 APPROVED')
}

main()
  .catch((e) => {
    console.error('Seed failed:', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
