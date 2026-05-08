// Live WhatsApp harness observer.
// Watches a real request in production-like runs and reports whether the
// expected cross-channel milestones occur within the allotted time.
//
// This script does not mutate request state. It is a verification observer for
// live-device runs where customer/provider interaction happens on WhatsApp.
//
// Usage:
//   npx tsx scripts/run-live-whatsapp-harness.ts --request-id=<jobRequestId>
// Optional:
//   --timeout-minutes=30
//   --poll-seconds=5
//   --json

import { db } from '../lib/db'

function argValue(flag: string) {
  const entry = process.argv.find((arg) => arg.startsWith(`${flag}=`))
  return entry ? entry.split('=').slice(1).join('=') : null
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function main() {
  const requestId = argValue('--request-id')
  if (!requestId) {
    throw new Error('Missing required --request-id=<jobRequestId>')
  }

  const timeoutMinutes = Math.max(1, Number.parseInt(argValue('--timeout-minutes') ?? '30', 10) || 30)
  const pollSeconds = Math.max(1, Number.parseInt(argValue('--poll-seconds') ?? '5', 10) || 5)
  const jsonOutput = process.argv.includes('--json')
  const deadline = Date.now() + timeoutMinutes * 60_000

  const timeline: Array<{ at: string; event: string; details?: Record<string, unknown> }> = []
  const observed = new Set<string>()

  while (Date.now() < deadline) {
    const request = await db.jobRequest.findUnique({
      where: { id: requestId },
      select: {
        id: true,
        status: true,
        assignmentMode: true,
        selectedProviderId: true,
        selectedLeadInviteId: true,
        leads: {
          select: {
            id: true,
            status: true,
            providerId: true,
            sentAt: true,
            respondedAt: true,
            customerSelectedAt: true,
            providerAcceptedAt: true,
          },
          orderBy: { sentAt: 'asc' },
        },
        match: {
          select: {
            id: true,
            status: true,
            providerId: true,
            booking: { select: { id: true, job: { select: { id: true, status: true } } } },
          },
        },
      },
    })

    if (!request) {
      throw new Error(`Request not found: ${requestId}`)
    }

    const keyRequest = `request_status:${request.status}`
    if (!observed.has(keyRequest)) {
      observed.add(keyRequest)
      timeline.push({
        at: new Date().toISOString(),
        event: keyRequest,
        details: { assignmentMode: request.assignmentMode },
      })
    }

    for (const lead of request.leads) {
      const leadKey = `lead:${lead.id}:${lead.status}`
      if (observed.has(leadKey)) continue
      observed.add(leadKey)
      timeline.push({
        at: new Date().toISOString(),
        event: leadKey,
        details: {
          providerId: lead.providerId,
          sentAt: lead.sentAt.toISOString(),
          respondedAt: lead.respondedAt?.toISOString() ?? null,
        },
      })
    }

    if (request.match?.booking?.job?.id) {
      const jobKey = `job_created:${request.match.booking.job.id}:${request.match.booking.job.status}`
      if (!observed.has(jobKey)) {
        observed.add(jobKey)
        timeline.push({
          at: new Date().toISOString(),
          event: jobKey,
          details: {
            matchId: request.match.id,
            bookingId: request.match.booking.id,
            providerId: request.match.providerId,
          },
        })
      }
    }

    // Terminal success for live run verification:
    // request matched and downstream booking/job created.
    if (request.status === 'MATCHED' && request.match?.booking?.job?.id) {
      const result = {
        ok: true,
        requestId,
        timeoutMinutes,
        observedEvents: timeline,
      }
      if (jsonOutput) {
        console.log(JSON.stringify(result, null, 2))
      } else {
        console.log('Live WhatsApp harness: PASS')
        console.log(`Request: ${requestId}`)
        for (const event of timeline) {
          console.log(`- ${event.at} ${event.event}`)
        }
      }
      return
    }

    await sleep(pollSeconds * 1000)
  }

  const fail = {
    ok: false,
    requestId,
    reason: 'timeout_waiting_for_job_confirmation',
    timeoutMinutes,
    observedEvents: timeline,
  }
  if (jsonOutput) {
    console.log(JSON.stringify(fail, null, 2))
  } else {
    console.log('Live WhatsApp harness: TIMEOUT')
    console.log(`Request: ${requestId}`)
    for (const event of timeline) {
      console.log(`- ${event.at} ${event.event}`)
    }
  }
  process.exitCode = 2
}

main()
  .catch((error) => {
    console.error('Live WhatsApp harness failed:', error)
    process.exit(1)
  })
  .finally(() => db.$disconnect())

