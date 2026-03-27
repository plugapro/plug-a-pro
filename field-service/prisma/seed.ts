// ─── Seed — field-service framework ───────────────────────────────────────────
// Run: pnpm db:seed
//
// Creates a complete, demo-ready dataset for local development:
//   • 1 business (configured via BUSINESS_SLUG env)
//   • 4 service categories, 8 services
//   • 6 service areas (Joburg + Cape Town)
//   • 2 technicians (pre-approved)
//   • 2 weeks of time slots (Mon–Fri, 3 windows/day)
//   • 1 sample customer
//   • 1 sample booking in CONFIRMED status (ready to dispatch)
//
// Safe to re-run — uses upsert throughout.

import { PrismaClient, PricingType } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const slug = process.env.BUSINESS_SLUG ?? 'plug-a-pro'

  // ── Business ───────────────────────────────────────────────────────────────
  const business = await prisma.business.upsert({
    where: { slug },
    create: {
      slug,
      name:     'Plug a Pro',
      phone:    '+27600000000',
      email:    'hello@plugapro.co.za',
      address:  'Johannesburg, Gauteng',
      timezone: 'Africa/Johannesburg',
      currency: 'ZAR',
      active:   true,
      settings: {},
    },
    update: { name: 'Plug a Pro' },
  })
  console.log(`✔ Business: ${business.name} (${business.id})`)

  // ── Services ───────────────────────────────────────────────────────────────
  const serviceData = [
    {
      name: 'Plumbing — Leak Repair',
      slug: 'plumbing-leak-repair',
      category: 'Plumbing',
      description: 'Fix dripping taps, burst pipes, and geyser leaks.',
      pricingType: PricingType.FIXED,
      basePrice: 650,
      callOutFee: 150,
      duration: 120,
      bufferTime: 30,
      sortOrder: 1,
    },
    {
      name: 'Plumbing — Drain Unblocking',
      slug: 'plumbing-drain-unblocking',
      category: 'Plumbing',
      description: 'Clear blocked sinks, toilets, and stormwater drains.',
      pricingType: PricingType.FIXED,
      basePrice: 550,
      callOutFee: 150,
      duration: 90,
      bufferTime: 30,
      sortOrder: 2,
    },
    {
      name: 'Electrical — Fault Finding',
      slug: 'electrical-fault-finding',
      category: 'Electrical',
      description: 'Diagnose and fix tripping breakers, dead sockets, and wiring faults.',
      pricingType: PricingType.FIXED,
      basePrice: 750,
      callOutFee: 200,
      duration: 120,
      bufferTime: 45,
      sortOrder: 3,
    },
    {
      name: 'Electrical — DB Board Inspection',
      slug: 'electrical-db-inspection',
      category: 'Electrical',
      description: 'Full distribution board inspection and compliance check.',
      pricingType: PricingType.QUOTE_REQUIRED,
      basePrice: null,
      callOutFee: 200,
      duration: 90,
      bufferTime: 45,
      sortOrder: 4,
    },
    {
      name: 'Cleaning — Deep Clean',
      slug: 'cleaning-deep-clean',
      category: 'Cleaning',
      description: 'Full home deep clean including kitchen, bathrooms, and bedrooms.',
      pricingType: PricingType.FIXED,
      basePrice: 900,
      callOutFee: 0,
      duration: 240,
      bufferTime: 30,
      sortOrder: 5,
    },
    {
      name: 'Cleaning — Regular Weekly',
      slug: 'cleaning-regular-weekly',
      category: 'Cleaning',
      description: 'Weekly home maintenance clean.',
      pricingType: PricingType.FIXED,
      basePrice: 450,
      callOutFee: 0,
      duration: 180,
      bufferTime: 30,
      sortOrder: 6,
    },
    {
      name: 'Painting — Interior Room',
      slug: 'painting-interior-room',
      category: 'Painting',
      description: 'Single room interior painting, walls and ceiling.',
      pricingType: PricingType.QUOTE_REQUIRED,
      basePrice: null,
      callOutFee: 0,
      duration: 480,
      bufferTime: 60,
      sortOrder: 7,
    },
    {
      name: 'Painting — Touch-up & Repairs',
      slug: 'painting-touchup',
      category: 'Painting',
      description: 'Small area touch-ups, crack filling, and repaint.',
      pricingType: PricingType.FIXED,
      basePrice: 600,
      callOutFee: 0,
      duration: 180,
      bufferTime: 30,
      sortOrder: 8,
    },
  ]

  const services: Record<string, string> = {}
  for (const s of serviceData) {
    const svc = await prisma.service.upsert({
      where: { businessId_slug: { businessId: business.id, slug: s.slug } },
      create: { ...s, businessId: business.id, active: true, metadata: {} },
      update: { name: s.name, basePrice: s.basePrice },
    })
    services[s.slug] = svc.id
  }
  console.log(`✔ Services: ${serviceData.length} upserted`)

  // ── Service areas ──────────────────────────────────────────────────────────
  const areas = [
    { suburb: 'Sandton',       city: 'Johannesburg', province: 'Gauteng',      postalCode: '2196' },
    { suburb: 'Randburg',      city: 'Johannesburg', province: 'Gauteng',      postalCode: '2194' },
    { suburb: 'Midrand',       city: 'Johannesburg', province: 'Gauteng',      postalCode: '1685' },
    { suburb: 'Centurion',     city: 'Pretoria',     province: 'Gauteng',      postalCode: '0157' },
    { suburb: 'Bellville',     city: 'Cape Town',    province: 'Western Cape', postalCode: '7530' },
    { suburb: 'Claremont',     city: 'Cape Town',    province: 'Western Cape', postalCode: '7708' },
  ]

  // Attach all areas to each service
  for (const serviceSlug of Object.keys(services)) {
    const serviceId = services[serviceSlug]
    // Remove old areas first to avoid duplicates on re-seed
    await prisma.serviceArea.deleteMany({ where: { serviceId } })
    await prisma.serviceArea.createMany({
      data: areas.map((a) => ({ ...a, serviceId })),
    })
  }
  console.log(`✔ Service areas: ${areas.length} per service`)

  // ── Technicians ────────────────────────────────────────────────────────────
  const techData = [
    {
      name:         'Sipho Dlamini',
      phone:        '+27711234567',
      skills:       ['Plumbing', 'General Maintenance'],
      serviceAreas: ['Sandton', 'Randburg', 'Midrand'],
    },
    {
      name:         'Thabo Mokoena',
      phone:        '+27722345678',
      skills:       ['Electrical', 'Painting'],
      serviceAreas: ['Sandton', 'Centurion', 'Midrand'],
    },
  ]

  for (const t of techData) {
    await prisma.technician.upsert({
      where: { businessId_phone: { businessId: business.id, phone: t.phone } } as never,
      create: { ...t, businessId: business.id, active: true },
      update: { name: t.name, skills: t.skills, serviceAreas: t.serviceAreas },
    })
  }
  console.log(`✔ Technicians: ${techData.length} upserted`)

  // Wait to get technician IDs
  const [tech1, tech2] = await Promise.all(
    techData.map((t) =>
      prisma.technician.findFirstOrThrow({
        where: { businessId: business.id, phone: t.phone },
      })
    )
  )

  // ── Availability ───────────────────────────────────────────────────────────
  // Mon–Fri 08:00–17:00 for both technicians
  for (const tech of [tech1, tech2]) {
    await prisma.availability.deleteMany({ where: { technicianId: tech.id } })
    await prisma.availability.createMany({
      data: [1, 2, 3, 4, 5].map((day) => ({
        technicianId: tech.id,
        dayOfWeek:   day,
        startTime:   '08:00',
        endTime:     '17:00',
        active:      true,
      })),
    })
  }
  console.log('✔ Availability: Mon–Fri 08:00–17:00 for all technicians')

  // ── Slots — 2 weeks from today ─────────────────────────────────────────────
  const WINDOWS = [
    { start: '08:00', end: '10:00' },
    { start: '10:00', end: '13:00' },
    { start: '14:00', end: '17:00' },
  ]

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const slotDates: Date[] = []

  for (let i = 1; i <= 14; i++) {
    const d = new Date(today)
    d.setDate(today.getDate() + i)
    if (d.getDay() !== 0 && d.getDay() !== 6) slotDates.push(d) // Mon–Fri only
  }

  // Clear old future slots then recreate
  await prisma.slot.deleteMany({
    where: { businessId: business.id, date: { gte: today } },
  })

  const slotRecords = slotDates.flatMap((date) =>
    WINDOWS.map((w) => ({
      businessId:  business.id,
      date,
      windowStart: w.start,
      windowEnd:   w.end,
      capacity:    3,
      booked:      0,
      blocked:     false,
    }))
  )

  await prisma.slot.createMany({ data: slotRecords })
  console.log(`✔ Slots: ${slotRecords.length} created (${slotDates.length} days × ${WINDOWS.length} windows)`)

  // ── Sample customer ────────────────────────────────────────────────────────
  const customer = await prisma.customer.upsert({
    where: { businessId_phone: { businessId: business.id, phone: '+27831234567' } },
    create: {
      businessId: business.id,
      phone:      '+27831234567',
      name:       'Zanele Khumalo',
      active:     true,
    },
    update: { name: 'Zanele Khumalo' },
  })
  console.log(`✔ Customer: ${customer.name}`)

  // ── Sample address ─────────────────────────────────────────────────────────
  const address = await prisma.address.create({
    data: {
      customerId: customer.id,
      label:      'Home',
      street:     '12 Acacia Avenue',
      suburb:     'Sandton',
      city:       'Johannesburg',
      province:   'Gauteng',
      postalCode: '2196',
      isDefault:  true,
    },
  }).catch(async () =>
    // If address already exists (re-seed), find the first one
    prisma.address.findFirstOrThrow({ where: { customerId: customer.id } })
  )

  // ── Sample booking (CONFIRMED — ready to dispatch) ─────────────────────────
  const firstSlot = await prisma.slot.findFirst({
    where: { businessId: business.id, blocked: false, booked: 0 },
    orderBy: { date: 'asc' },
  })

  const firstServiceId = services['plumbing-leak-repair']

  // Only create if no existing CONFIRMED booking for this customer
  const existingBooking = await prisma.booking.findFirst({
    where: { customerId: customer.id, status: { in: ['CONFIRMED', 'SCHEDULED'] } },
  })

  if (!existingBooking && firstSlot) {
    const booking = await prisma.booking.create({
      data: {
        businessId:      business.id,
        customerId:      customer.id,
        serviceId:       firstServiceId,
        addressId:       address.id,
        slotId:          firstSlot.id,
        status:          'CONFIRMED',
        totalAmount:     800,
        depositAmount:   0,
        scheduledDate:   firstSlot.date,
        scheduledWindow: `${firstSlot.windowStart}–${firstSlot.windowEnd}`,
        notes:           'Seed booking — ready to dispatch via /admin/dispatch',
      },
    })

    // Mark slot as booked
    await prisma.slot.update({
      where: { id: firstSlot.id },
      data: { booked: { increment: 1 } },
    })

    // Create a payment record (simulated PAID)
    await prisma.payment.create({
      data: {
        bookingId:    booking.id,
        status:       'PAID',
        amount:       800,
        currency:     'ZAR',
        pspProvider:  'seed',
        pspReference: 'SEED-0001',
        paidAt:       new Date(),
        metadata:     { note: 'Seeded payment for dev testing' },
      },
    })

    console.log(`✔ Booking: ${booking.id.slice(-8).toUpperCase()} (CONFIRMED, ready to dispatch)`)
  } else {
    console.log('✔ Booking: skipped (one already exists for this customer)')
  }

  // ── TechnicianApplication (PENDING — to test applications page) ────────────
  const existingApp = await prisma.technicianApplication.findFirst({
    where: { businessId: business.id, phone: '+27799887766' },
  })

  if (!existingApp) {
    await prisma.technicianApplication.create({
      data: {
        businessId:   business.id,
        phone:        '+27799887766',
        name:         'Bongani Nkosi',
        skills:       ['Plumbing', 'Tiling'],
        serviceAreas: ['Randburg'],
        status:       'PENDING',
      },
    })
    console.log('✔ TechnicianApplication: Bongani Nkosi (PENDING)')
  }

  console.log('\n✅ Seed complete.')
  console.log(`   Business slug: ${slug}`)
  console.log(`   Admin URL:     /admin`)
  console.log(`   Dispatch:      /admin/dispatch (1 booking ready)`)
  console.log(`   Applications:  /admin/applications (1 pending)`)
}

main()
  .catch((e) => {
    console.error('Seed failed:', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
