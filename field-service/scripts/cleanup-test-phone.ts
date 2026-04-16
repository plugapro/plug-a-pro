// One-off script: delete all data for a test phone number
// Usage: npx tsx scripts/cleanup-test-phone.ts
//
// Handles the full cascade manually in FK-safe order.

import { db } from '../lib/db'

const PHONES = ['+27823035070', '27823035070', '0823035070']
const E164 = ['+27823035070', '27823035070']

async function main() {
  console.log('Checking data for phones:', PHONES)

  // ── Snapshot ───────────────────────────────────────────────────────────────
  const customers = await db.customer.findMany({ where: { phone: { in: E164 } } })
  const providers = await db.provider.findMany({ where: { phone: { in: E164 } } })
  const provApps = await db.providerApplication.findMany({ where: { phone: { in: PHONES } } })
  const convs = await db.conversation.findMany({ where: { phone: { in: E164 } } })
  const waitlist = await db.serviceAreaWaitlist.findMany({ where: { phone: { in: PHONES } } })

  console.log('\nFound:')
  console.log(' customers:', customers.length, customers.map(c => ({ id: c.id, name: c.name, phone: c.phone })))
  console.log(' providers:', providers.length, providers.map(p => ({ id: p.id, name: p.name })))
  console.log(' provider_applications:', provApps.length)
  console.log(' conversations:', convs.length)
  console.log(' service_area_waitlist:', waitlist.length)

  if (
    customers.length === 0 &&
    providers.length === 0 &&
    provApps.length === 0 &&
    convs.length === 0 &&
    waitlist.length === 0
  ) {
    console.log('\nNothing to clean up.')
    return
  }

  // ── Delete in FK-safe order ───────────────────────────────────────────────
  const customerIds = customers.map(c => c.id)
  const providerIds = providers.map(p => p.id)

  if (customerIds.length > 0) {
    // job_requests → leads (Cascade), matches (no Cascade from JobRequest),
    // quotes, bookings, jobs, payments all chain down
    // Delete bottom-up inside customer scope

    // 1. Get all job request IDs for this customer
    const jobRequests = await db.jobRequest.findMany({
      where: { customerId: { in: customerIds } },
      select: { id: true },
    })
    const jrIds = jobRequests.map(j => j.id)
    console.log('\nJob requests:', jrIds.length)

    if (jrIds.length > 0) {
      // Get matches for these job requests
      const matches = await db.match.findMany({
        where: { jobRequestId: { in: jrIds } },
        select: { id: true },
      })
      const matchIds = matches.map(m => m.id)
      console.log('Matches:', matchIds.length)

      if (matchIds.length > 0) {
        // Get bookings for these matches
        const bookings = await db.booking.findMany({
          where: { matchId: { in: matchIds } },
          select: { id: true },
        })
        const bookingIds = bookings.map(b => b.id)
        console.log('Bookings:', bookingIds.length)

        if (bookingIds.length > 0) {
          // payments cascade from bookings — handled automatically if Cascade is set
          // but let's be explicit
          await db.payment.deleteMany({ where: { bookingId: { in: bookingIds } } })
          console.log('Deleted payments')

          // jobs → job_status_events, extra_work, attachments (all Cascade from job)
          const jobs = await db.job.findMany({ where: { bookingId: { in: bookingIds } }, select: { id: true } })
          if (jobs.length > 0) {
            await db.job.deleteMany({ where: { id: { in: jobs.map(j => j.id) } } })
            console.log('Deleted jobs:', jobs.length)
          }

          await db.booking.deleteMany({ where: { id: { in: bookingIds } } })
          console.log('Deleted bookings:', bookingIds.length)
        }

        // quotes Cascade from match
        await db.match.deleteMany({ where: { id: { in: matchIds } } })
        console.log('Deleted matches:', matchIds.length)
      }

      // leads Cascade from jobRequest — but delete explicitly to be safe
      await db.lead.deleteMany({ where: { jobRequestId: { in: jrIds } } })
      // attachments linked to jobRequest
      await db.attachment.deleteMany({ where: { jobRequestId: { in: jrIds } } })
      await db.jobRequest.deleteMany({ where: { id: { in: jrIds } } })
      console.log('Deleted job_requests:', jrIds.length)
    }

    // addresses Cascade from customer — handled, but let's be explicit
    await db.address.deleteMany({ where: { customerId: { in: customerIds } } })
    console.log('Deleted addresses')

    await db.customer.deleteMany({ where: { id: { in: customerIds } } })
    console.log('Deleted customers:', customerIds.length)
  }

  if (providerIds.length > 0) {
    // All provider sub-tables Cascade: skills, certs, service_areas, schedule, etc.
    await db.provider.deleteMany({ where: { id: { in: providerIds } } })
    console.log('Deleted providers:', providerIds.length)
  }

  // Provider applications (standalone)
  const paDeleted = await db.providerApplication.deleteMany({ where: { phone: { in: PHONES } } })
  console.log('Deleted provider_applications:', paDeleted.count)

  // Conversations
  const cvDeleted = await db.conversation.deleteMany({ where: { phone: { in: E164 } } })
  console.log('Deleted conversations:', cvDeleted.count)

  // Service area waitlist
  const wlDeleted = await db.serviceAreaWaitlist.deleteMany({ where: { phone: { in: PHONES } } })
  console.log('Deleted service_area_waitlist:', wlDeleted.count)

  // Inbound WhatsApp messages
  const imDeleted = await db.inboundWhatsAppMessage.deleteMany({ where: { phone: { in: E164 } } })
  console.log('Deleted inbound_whatsapp_messages:', imDeleted.count)

  console.log('\n✅ Cleanup complete for +27823035070')
}

main()
  .catch((err) => { console.error('Cleanup failed:', err); process.exit(1) })
  .finally(() => db.$disconnect())
