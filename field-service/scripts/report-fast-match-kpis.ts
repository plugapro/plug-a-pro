// Fast Match KPI report generator.
// Produces a 7-day (or custom window) summary used as the release gate
// baseline for timeout, decline, and queue-exhaustion trends.
//
// Usage:
//   npx tsx scripts/report-fast-match-kpis.ts
//   npx tsx scripts/report-fast-match-kpis.ts --days=14 --json

import { db } from '../lib/db'

function argValue(flag: string) {
  const entry = process.argv.find((arg) => arg.startsWith(`${flag}=`))
  return entry ? entry.split('=').slice(1).join('=') : null
}

function median(values: number[]) {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[middle]
  return (sorted[middle - 1] + sorted[middle]) / 2
}

async function main() {
  // Default baseline window follows the release soft-gate requirement.
  const days = Math.max(1, Number.parseInt(argValue('--days') ?? '7', 10) || 7)
  const jsonOutput = process.argv.includes('--json')
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

  const requests = await db.jobRequest.findMany({
    where: {
      assignmentMode: 'AUTO_ASSIGN',
      createdAt: { gte: since },
      isTestRequest: false,
    },
    select: {
      id: true,
      status: true,
      createdAt: true,
      submittedAt: true,
      updatedAt: true,
      leads: {
        select: {
          id: true,
          status: true,
          sentAt: true,
          respondedAt: true,
        },
      },
    },
  })

  const allLeads = requests.flatMap((request) => request.leads)
  const declinedLeads = allLeads.filter((lead) => lead.status === 'DECLINED')
  const expiredLeads = allLeads.filter((lead) => lead.status === 'EXPIRED')
  const queueExhaustedRequests = requests.filter((request) => request.status === 'EXPIRED')

  const firstResponseMinutes = requests
    .map((request) => {
      const firstResponse = request.leads
        .filter((lead) => lead.respondedAt != null)
        .sort((a, b) => a.respondedAt!.getTime() - b.respondedAt!.getTime())[0]
      if (!firstResponse?.respondedAt) return null
      return (firstResponse.respondedAt.getTime() - firstResponse.sentAt.getTime()) / 60_000
    })
    .filter((value): value is number => value != null && Number.isFinite(value) && value >= 0)

  const confirmationMinutes = requests
    .filter((request) => request.status === 'MATCHED')
    .map((request) => {
      const startAt = request.submittedAt ?? request.createdAt
      return (request.updatedAt.getTime() - startAt.getTime()) / 60_000
    })
    .filter((value) => Number.isFinite(value) && value >= 0)

  const summary = {
    windowDays: days,
    since: since.toISOString(),
    totals: {
      quickMatchRequests: requests.length,
      providerInvites: allLeads.length,
      providerDeclines: declinedLeads.length,
      providerTimeouts: expiredLeads.length,
      queueExhaustedRequests: queueExhaustedRequests.length,
    },
    rates: {
      declineRate: allLeads.length > 0 ? declinedLeads.length / allLeads.length : 0,
      timeoutRate: allLeads.length > 0 ? expiredLeads.length / allLeads.length : 0,
      queueExhaustionRate: requests.length > 0 ? queueExhaustedRequests.length / requests.length : 0,
    },
    latencyMinutes: {
      medianFirstProviderResponse: median(firstResponseMinutes),
      medianProviderConfirmation: median(confirmationMinutes),
    },
  }

  if (jsonOutput) {
    console.log(JSON.stringify(summary, null, 2))
    return
  }

  console.log('Fast Match KPI Baseline')
  console.log(`Window: last ${summary.windowDays} day(s) since ${summary.since}`)
  console.log(`Requests: ${summary.totals.quickMatchRequests}`)
  console.log(`Invites: ${summary.totals.providerInvites}`)
  console.log(`Declines: ${summary.totals.providerDeclines} (${(summary.rates.declineRate * 100).toFixed(2)}%)`)
  console.log(`Timeouts: ${summary.totals.providerTimeouts} (${(summary.rates.timeoutRate * 100).toFixed(2)}%)`)
  console.log(`Queue exhausted: ${summary.totals.queueExhaustedRequests} (${(summary.rates.queueExhaustionRate * 100).toFixed(2)}%)`)
  console.log(
    `Median first response (minutes): ${
      summary.latencyMinutes.medianFirstProviderResponse == null
        ? 'n/a'
        : summary.latencyMinutes.medianFirstProviderResponse.toFixed(2)
    }`,
  )
  console.log(
    `Median provider confirmation (minutes): ${
      summary.latencyMinutes.medianProviderConfirmation == null
        ? 'n/a'
        : summary.latencyMinutes.medianProviderConfirmation.toFixed(2)
    }`,
  )
}

main()
  .catch((error) => {
    console.error('Fast Match KPI report failed:', error)
    process.exit(1)
  })
  .finally(() => db.$disconnect())

