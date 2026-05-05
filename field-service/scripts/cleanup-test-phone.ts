// Reset script: wipe all data for one or more test phone numbers.
// Usage: npx tsx scripts/cleanup-test-phone.ts
//
// Handles the full cascade manually in FK-safe order, including
// the circular FK between JobRequest.latestDispatchDecisionId ↔ DispatchDecision.

import { db } from '../lib/db'

const TARGET_PHONES_RAW = [
  '0821234567',   // Neutral dummy provider
  '0773923802',   // Stephanie (customer)
]

// Normalise to all variants stored in the DB
function phoneVariants(raw: string): string[] {
  const digits = raw.replace(/\D/g, '')
  const local = digits.startsWith('27') ? '0' + digits.slice(2) : digits.startsWith('0') ? digits : '0' + digits
  const e164 = '+27' + local.slice(1)
  const plain27 = '27' + local.slice(1)
  return [local, e164, plain27]
}

const ALL_VARIANTS = TARGET_PHONES_RAW.flatMap(phoneVariants)
const E164_VARIANTS = TARGET_PHONES_RAW.map(p => {
  const digits = p.replace(/\D/g, '')
  const local = digits.startsWith('27') ? '0' + digits.slice(2) : digits
  return '+27' + local.slice(1)
})

async function main() {
  console.log('Target phones (all variants):', ALL_VARIANTS)

  // ── Snapshot ───────────────────────────────────────────────────────────────
  const customers = await db.customer.findMany({ where: { phone: { in: [...ALL_VARIANTS] } } })
  const providers = await db.provider.findMany({ where: { phone: { in: [...ALL_VARIANTS] } } })
  const provApps = await db.providerApplication.findMany({ where: { phone: { in: [...ALL_VARIANTS] } } })
  const convs = await db.conversation.findMany({ where: { phone: { in: [...ALL_VARIANTS] } } })
  const waitlist = await db.serviceAreaWaitlist.findMany({ where: { phone: { in: [...ALL_VARIANTS] } } })

  console.log('\nFound:')
  console.log(' customers:', customers.map(c => ({ id: c.id, name: c.name, phone: c.phone })))
  console.log(' providers:', providers.map(p => ({ id: p.id, name: p.name, phone: p.phone })))
  console.log(' provider_applications:', provApps.length)
  console.log(' conversations:', convs.length)
  console.log(' service_area_waitlist:', waitlist.length)

  if (!customers.length && !providers.length && !provApps.length && !convs.length && !waitlist.length) {
    console.log('\nNothing to clean up.')
    return
  }

  const customerIds = customers.map(c => c.id)
  const providerIds = providers.map(p => p.id)

  // ── Customer-scoped data ───────────────────────────────────────────────────
  if (customerIds.length > 0) {
    const jobRequests = await db.jobRequest.findMany({
      where: { customerId: { in: customerIds } },
      select: { id: true },
    })
    const jrIds = jobRequests.map(j => j.id)
    console.log('\nJob requests:', jrIds.length)

    if (jrIds.length > 0) {
      // --- Get downstream IDs ---
      const matches = await db.match.findMany({
        where: { jobRequestId: { in: jrIds } },
        select: { id: true },
      })
      const matchIds = matches.map(m => m.id)
      console.log('Matches:', matchIds.length)

      if (matchIds.length > 0) {
        const bookings = await db.booking.findMany({
          where: { matchId: { in: matchIds } },
          select: { id: true },
        })
        const bookingIds = bookings.map(b => b.id)
        console.log('Bookings:', bookingIds.length)

        if (bookingIds.length > 0) {
          const jobs = await db.job.findMany({
            where: { bookingId: { in: bookingIds } },
            select: { id: true },
          })
          const jobIds = jobs.map(j => j.id)

          if (jobIds.length > 0) {
            await db.review.deleteMany({ where: { jobId: { in: jobIds } } })
            await db.job.deleteMany({ where: { id: { in: jobIds } } })
            console.log('Deleted jobs + reviews:', jobIds.length)
          }

          await db.payment.deleteMany({ where: { bookingId: { in: bookingIds } } })
          await db.messageEvent.deleteMany({ where: { bookingId: { in: bookingIds } } })
          await db.booking.deleteMany({ where: { id: { in: bookingIds } } })
          console.log('Deleted bookings:', bookingIds.length)
        }

        // inspection slots hang off matches
        await db.inspectionSlot.deleteMany({ where: { matchId: { in: matchIds } } })
        // quotes Cascade from match
        await db.match.deleteMany({ where: { id: { in: matchIds } } })
        console.log('Deleted matches:', matchIds.length)
      }

      // Clear circular FK before deleting dispatch decisions
      await db.jobRequest.updateMany({
        where: { id: { in: jrIds } },
        data: { latestDispatchDecisionId: null },
      })

      // Delete in dependency order: deeper models first
      await db.attachment.deleteMany({ where: { jobRequestId: { in: jrIds } } })
      await db.matchAttempt.deleteMany({ where: { jobRequestId: { in: jrIds } } })
      await db.lead.deleteMany({ where: { jobRequestId: { in: jrIds } } })
      await db.assignmentHold.deleteMany({ where: { jobRequestId: { in: jrIds } } })
      await db.dispatchDecision.deleteMany({ where: { jobRequestId: { in: jrIds } } })
      await db.jobRequest.deleteMany({ where: { id: { in: jrIds } } })
      console.log('Deleted job_requests + all sub-tables:', jrIds.length)
    }

    await db.customerNote.deleteMany({ where: { customerId: { in: customerIds } } })
    await db.address.deleteMany({ where: { customerId: { in: customerIds } } })
    await db.customer.deleteMany({ where: { id: { in: customerIds } } })
    console.log('Deleted customers:', customerIds.length)
  }

  // ── Provider-scoped data ───────────────────────────────────────────────────
  if (providerIds.length > 0) {
    // Leads where this provider is the recipient (not already deleted via customer path)
    const provLeads = await db.lead.findMany({
      where: { providerId: { in: providerIds } },
      select: { id: true, jobRequestId: true },
    })
    if (provLeads.length > 0) {
      const provJrIds = [...new Set(provLeads.map(l => l.jobRequestId))]
      await db.jobRequest.updateMany({
        where: { id: { in: provJrIds } },
        data: { latestDispatchDecisionId: null },
      })
      await db.matchAttempt.deleteMany({ where: { providerId: { in: providerIds } } })
      await db.assignmentHold.deleteMany({ where: { providerId: { in: providerIds } } })
      await db.lead.deleteMany({ where: { providerId: { in: providerIds } } })
      await db.dispatchDecision.deleteMany({ where: { jobRequestId: { in: provJrIds } } })
      console.log('Deleted orphan provider leads/holds:', provLeads.length)
    }

    await db.providerNote.deleteMany({ where: { providerId: { in: providerIds } } })
    // All provider sub-tables cascade from provider row
    await db.provider.deleteMany({ where: { id: { in: providerIds } } })
    console.log('Deleted providers:', providerIds.length)
  }

  // ── Shared cleanup ─────────────────────────────────────────────────────────
  const paDeleted = await db.providerApplication.deleteMany({ where: { phone: { in: [...ALL_VARIANTS] } } })
  console.log('Deleted provider_applications:', paDeleted.count)

  const cvDeleted = await db.conversation.deleteMany({ where: { phone: { in: [...ALL_VARIANTS] } } })
  console.log('Deleted conversations:', cvDeleted.count)

  const wlDeleted = await db.serviceAreaWaitlist.deleteMany({ where: { phone: { in: [...ALL_VARIANTS] } } })
  console.log('Deleted service_area_waitlist:', wlDeleted.count)

  const imDeleted = await db.inboundWhatsAppMessage.deleteMany({ where: { phone: { in: [...ALL_VARIANTS] } } })
  console.log('Deleted inbound_whatsapp_messages:', imDeleted.count)

  const meDeleted = await db.messageEvent.deleteMany({ where: { to: { in: [...ALL_VARIANTS] } } })
  console.log('Deleted message_events (to):', meDeleted.count)

  console.log('\n✅ Cleanup complete for:', TARGET_PHONES_RAW.join(', '))
  console.log('Both numbers can now start fresh journeys.')
}

main()
  .catch((err) => { console.error('Cleanup failed:', err); process.exit(1) })
  .finally(() => db.$disconnect())
