// ─── Seed — field-service marketplace schema ──────────────────────────────────
// Run: pnpm db:seed
//
// Creates a complete, demo-ready dataset for local development:
//   • 2 customers with addresses
//   • 3 providers with schedules (Mon–Fri)
//   • 2 provider applications (1 PENDING, 1 APPROVED)
//   • 2 job requests (1 matched through to a completed job, 1 open)
//   • 1 match → 1 quote → 1 booking → 1 completed job with a review
//   • 1 conversation record per customer phone
//
// Safe to re-run — uses upsert / findFirst guards throughout.

import {
  PrismaClient,
  JobRequestStatus,
  LeadStatus,
  MatchStatus,
  QuoteStatus,
  BookingStatus,
  JobStatus,
  ReviewerType,
  ApplicationStatus,
} from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  // ── Customers ────────────────────────────────────────────────────────────────
  const customer1 = await prisma.customer.upsert({
    where: { phone: '+27831234567' },
    create: {
      phone:  '+27831234567',
      email:  'zanele.khumalo@example.co.za',
      name:   'Zanele Khumalo',
    },
    update: { name: 'Zanele Khumalo' },
  })

  const customer2 = await prisma.customer.upsert({
    where: { phone: '+27839876543' },
    create: {
      phone:  '+27839876543',
      email:  'lerato.molefe@example.co.za',
      name:   'Lerato Molefe',
    },
    update: { name: 'Lerato Molefe' },
  })

  console.log(`✔ Customers: ${customer1.name}, ${customer2.name}`)

  // ── Addresses ────────────────────────────────────────────────────────────────
  const address1 = await prisma.address.findFirst({ where: { customerId: customer1.id } })
    ?? await prisma.address.create({
      data: {
        customerId: customer1.id,
        street:     '12 Acacia Avenue',
        suburb:     'Sandton',
        city:       'Johannesburg',
        province:   'Gauteng',
      },
    })

  const address2 = await prisma.address.findFirst({ where: { customerId: customer2.id } })
    ?? await prisma.address.create({
      data: {
        customerId: customer2.id,
        street:     '7 Protea Road',
        suburb:     'Claremont',
        city:       'Cape Town',
        province:   'Western Cape',
      },
    })

  console.log(`✔ Addresses: ${address1.suburb}, ${address2.suburb}`)

  // ── Providers ─────────────────────────────────────────────────────────────────
  const providerData = [
    {
      phone:        '+27711234567',
      name:         'Sipho Dlamini',
      skills:       ['Plumbing', 'General Maintenance'],
      serviceAreas: ['Sandton', 'Randburg', 'Midrand'],
      active:       true,
      verified:     true,
    },
    {
      phone:        '+27722345678',
      name:         'Thabo Mokoena',
      skills:       ['Electrical', 'Painting'],
      serviceAreas: ['Sandton', 'Centurion', 'Midrand'],
      active:       true,
      verified:     true,
    },
    {
      phone:        '+27733456789',
      name:         'Nomsa Zulu',
      skills:       ['Cleaning', 'Gardening'],
      serviceAreas: ['Claremont', 'Bellville', 'Observatory'],
      active:       true,
      verified:     true,
    },
  ]

  for (const p of providerData) {
    await prisma.provider.upsert({
      where:  { phone: p.phone },
      create: p,
      update: { name: p.name, skills: p.skills, serviceAreas: p.serviceAreas },
    })
  }

  const [provider1, provider2, provider3] = await Promise.all(
    providerData.map((p) => prisma.provider.findFirstOrThrow({ where: { phone: p.phone } }))
  )

  console.log(`✔ Providers: ${provider1.name}, ${provider2.name}, ${provider3.name}`)

  // ── Provider schedules (Mon–Fri 08:00–17:00) ──────────────────────────────────
  for (const provider of [provider1, provider2, provider3]) {
    await prisma.providerSchedule.deleteMany({ where: { providerId: provider.id } })
    await prisma.providerSchedule.createMany({
      data: [1, 2, 3, 4, 5].map((day) => ({
        providerId: provider.id,
        dayOfWeek:  day,
        startTime:  '08:00',
        endTime:    '17:00',
      })),
    })
  }
  console.log('✔ Provider schedules: Mon–Fri 08:00–17:00 for all providers')

  // ── Provider applications ─────────────────────────────────────────────────────
  const app1Phone = '+27799887766'
  const existingApp1 = await prisma.providerApplication.findFirst({ where: { phone: app1Phone } })
  if (!existingApp1) {
    await prisma.providerApplication.create({
      data: {
        phone:        app1Phone,
        name:         'Bongani Nkosi',
        skills:       ['Plumbing', 'Tiling'],
        serviceAreas: ['Randburg', 'Roodepoort'],
        status:       ApplicationStatus.PENDING,
      },
    })
    console.log('✔ ProviderApplication: Bongani Nkosi (PENDING)')
  }

  const app2Phone = '+27788776655'
  const existingApp2 = await prisma.providerApplication.findFirst({ where: { phone: app2Phone } })
  if (!existingApp2) {
    await prisma.providerApplication.create({
      data: {
        phone:        app2Phone,
        name:         'Fatima Cassim',
        skills:       ['Electrical'],
        serviceAreas: ['Centurion', 'Pretoria North'],
        status:       ApplicationStatus.APPROVED,
      },
    })
    console.log('✔ ProviderApplication: Fatima Cassim (APPROVED)')
  }

  // ── Job request 1: Matched → completed ───────────────────────────────────────
  // Skip if we already have a completed job for customer1 to stay idempotent
  const existingJob = await prisma.job.findFirst({
    where: { status: JobStatus.COMPLETED, booking: { match: { jobRequest: { customerId: customer1.id } } } },
  })

  if (!existingJob) {
    const jobRequest1 = await prisma.jobRequest.create({
      data: {
        customerId:  customer1.id,
        addressId:   address1.id,
        category:    'Plumbing',
        title:       'Leaking tap in kitchen',
        description: 'Kitchen cold-water tap has been dripping for a week. Needs washer replacement or full tap.',
        status:      JobRequestStatus.MATCHED,
      },
    })

    const match1 = await prisma.match.create({
      data: {
        jobRequestId:      jobRequest1.id,
        providerId:        provider1.id,
        status:            MatchStatus.QUOTE_APPROVED,
        inspectionNeeded:  false,
      },
    })

    const quote1 = await prisma.quote.create({
      data: {
        matchId:       match1.id,
        amount:        650,
        labourCost:    500,
        materialsCost: 150,
        description:   'Replace kitchen tap washers and re-seal. Includes call-out.',
        status:        QuoteStatus.APPROVED,
        approvalToken: 'seed-quote-1-token',
      },
    })

    const scheduledDate = new Date('2026-03-15T09:00:00.000Z')

    const booking1 = await prisma.booking.create({
      data: {
        matchId:       match1.id,
        quoteId:       quote1.id,
        status:        BookingStatus.COMPLETED,
        scheduledDate,
      },
    })

    const job1 = await prisma.job.create({
      data: {
        bookingId:  booking1.id,
        providerId: provider1.id,
        status:     JobStatus.COMPLETED,
      },
    })

    await prisma.review.create({
      data: {
        jobId:        job1.id,
        reviewerType: ReviewerType.CUSTOMER,
        customerId:   customer1.id,
        score:        5,
        comment:      'Sipho was professional and fixed the tap quickly. Highly recommend.',
      },
    })

    console.log(`✔ JobRequest 1 → Match → Quote → Booking → Job (COMPLETED) + Review`)
  } else {
    console.log('✔ JobRequest 1 pipeline: skipped (already exists)')
  }

  // ── Job request 2: Open (awaiting matching) ───────────────────────────────────
  const existingOpenRequest = await prisma.jobRequest.findFirst({
    where: { customerId: customer2.id, status: JobRequestStatus.OPEN },
  })

  if (!existingOpenRequest) {
    await prisma.jobRequest.create({
      data: {
        customerId:  customer2.id,
        addressId:   address2.id,
        category:    'Electrical',
        title:       'No power to lounge plug points',
        description: 'Three plug points in the lounge stopped working after load-shedding. Breaker trips when reset.',
        status:      JobRequestStatus.OPEN,
      },
    })
    console.log('✔ JobRequest 2: Open electrical job for Lerato Molefe')
  } else {
    console.log('✔ JobRequest 2: skipped (already exists)')
  }

  // ── Conversations (one per customer phone) ───────────────────────────────────
  const convExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 h from now

  await prisma.conversation.upsert({
    where:  { phone: customer1.phone },
    create: {
      phone:     customer1.phone,
      flow:      'job_request',
      step:      'complete',
      data:      { lastJobCategory: 'Plumbing' },
      expiresAt: convExpiry,
    },
    update: { step: 'complete', data: { lastJobCategory: 'Plumbing' } },
  })

  await prisma.conversation.upsert({
    where:  { phone: customer2.phone },
    create: {
      phone:     customer2.phone,
      flow:      'job_request',
      step:      'describe_problem',
      data:      { category: 'Electrical' },
      expiresAt: convExpiry,
    },
    update: { step: 'describe_problem', data: { category: 'Electrical' } },
  })

  console.log('✔ Conversations: 2 upserted')

  console.log('\n✅ Seed complete.')
  console.log('   Providers:    3 active + verified')
  console.log('   Customers:    2 with addresses')
  console.log('   Jobs:         1 completed (with review), 1 open request')
  console.log('   Applications: 1 pending, 1 approved')
}

main()
  .catch((e) => {
    console.error('Seed failed:', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
