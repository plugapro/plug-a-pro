import { db } from './db'
import { sendCompletionCheckMessage, sendCustomerReviewRequest, sendProviderReviewNudge, sendAdminEscalation } from './whatsapp'
import { sendButtons } from './whatsapp-interactive'
import { createReviewUrl } from './review-access'
import { isEnabled } from './flags'

const DELAY_DAYS = 2, RETRY_DAYS = 3, MAX_RETRIES = 2

export async function sendPendingCompletionChecks() {
  if (!await isEnabled('pilot.completion-check')) return { sent: 0, skipped: 0, errors: 0 }
  const cutoff = new Date(Date.now() - DELAY_DAYS * 864e5)
  const rows = await db.match.findMany({
    where: { completionCheckSentAt: null, completionCheckStatus: null, status: { not: 'CANCELLED' }, jobRequest: { assignmentMode: 'AUTO_ASSIGN', requestedWindowEnd: { lte: cutoff } } },
    select: { id: true, jobRequest: { select: { category: true, requestedWindowEnd: true, customer: { select: { id: true, name: true, phone: true } } } }, provider: { select: { id: true, name: true, phone: true } } },
    take: 100,
  })
  let sent = 0, skipped = 0, errors = 0
  for (const m of rows) {
    try {
      await sendCompletionCheckMessage({ customerPhone: m.jobRequest.customer.phone, customerName: m.jobRequest.customer.name, providerName: m.provider.name, serviceName: m.jobRequest.category, matchId: m.id })
      await db.match.update({ where: { id: m.id }, data: { completionCheckSentAt: new Date(), completionCheckStatus: 'SENT' } })
      sent++
    } catch (err) { errors++; console.error(`[cc] failed ${m.id}:`, err) }
  }
  return { sent, skipped, errors }
}

export async function retryPendingCompletionChecks() {
  if (!await isEnabled('pilot.completion-check')) return { sent: 0, flagged: 0, errors: 0 }
  const retryCutoff = new Date(Date.now() - RETRY_DAYS * 864e5)
  const rows = await db.match.findMany({
    where: { completionCheckStatus: { in: ['NO_RESCHEDULED', 'NO_NOT_FINISHED'] }, completionCheckSentAt: { lte: retryCutoff }, completionCheckRetries: { lt: MAX_RETRIES } },
    select: { id: true, completionCheckRetries: true, jobRequest: { select: { category: true, customer: { select: { id: true, name: true, phone: true } } } }, provider: { select: { id: true, name: true, phone: true } } },
    take: 100,
  })
  let sent = 0, flagged = 0, errors = 0
  for (const m of rows) {
    const next = m.completionCheckRetries + 1
    if (next > MAX_RETRIES) { try { await flagMatchToAdmin(m.id); flagged++ } catch (e) { errors++; console.error(`[cc] flag failed ${m.id}:`, e) }; continue }
    try {
      await sendCompletionCheckMessage({ customerPhone: m.jobRequest.customer.phone, customerName: m.jobRequest.customer.name, providerName: m.provider.name, serviceName: m.jobRequest.category, matchId: m.id })
      await db.match.update({ where: { id: m.id }, data: { completionCheckSentAt: new Date(), completionCheckStatus: 'SENT', completionCheckRetries: next } })
      sent++
    } catch (err) { errors++; console.error(`[cc] retry failed ${m.id}:`, err) }
  }
  return { sent, flagged, errors }
}

export async function handleCompletionCheckYes(params: { matchId: string; customerPhone: string }) {
  const m = await db.match.findUnique({ where: { id: params.matchId }, select: { id: true, reviewRequestSentAt: true, completionCheckStatus: true, jobRequest: { select: { category: true, customer: { select: { id: true, name: true, phone: true } } } }, provider: { select: { id: true, name: true, phone: true } } } })
  if (!m) { console.error(`[cc] handleYes: match ${params.matchId} not found`); return }
  if (m.reviewRequestSentAt) { console.info(`[cc] handleYes: review already sent for ${params.matchId}`); return }
  await db.match.update({ where: { id: params.matchId }, data: { completionCheckStatus: 'YES' } })
  const cUrl = createReviewUrl({ matchId: params.matchId, reviewerType: 'CUSTOMER' })
  const pUrl = createReviewUrl({ matchId: params.matchId, reviewerType: 'PROVIDER' })
  const results = await Promise.allSettled([
    cUrl ? sendCustomerReviewRequest({ customerPhone: m.jobRequest.customer.phone, customerName: m.jobRequest.customer.name, providerName: m.provider.name, serviceName: m.jobRequest.category, reviewUrl: cUrl, matchId: params.matchId }) : Promise.resolve(),
    pUrl ? sendProviderReviewNudge({ providerPhone: m.provider.phone, providerName: m.provider.name, customerName: m.jobRequest.customer.name, serviceName: m.jobRequest.category, reviewUrl: pUrl, matchId: params.matchId }) : Promise.resolve(),
  ])
  for (const r of results) if (r.status === 'rejected') console.error(`[cc] send failed ${params.matchId}:`, r.reason)
  await db.match.update({ where: { id: params.matchId }, data: { reviewRequestSentAt: new Date() } })
}

export async function handleCompletionCheckNo(params: { matchId: string; customerPhone: string; providerFirstName: string }) {
  await sendButtons(params.customerPhone, `No problem — what happened with your ${params.providerFirstName} job?`, [
    { id: `completion_why_rescheduled_${params.matchId}`, title: 'We rescheduled' },
    { id: `completion_why_not_finished_${params.matchId}`, title: 'Not done yet' },
    { id: `completion_why_didnt_show_${params.matchId}`, title: "Didn't show up" },
  ], undefined, { templateName: 'completion_check:why', metadata: { matchId: params.matchId } })
}

export async function handleCompletionCheckWhyRescheduled(params: { matchId: string; customerPhone: string }) {
  const m = await db.match.findUnique({ where: { id: params.matchId }, select: { completionCheckRetries: true } })
  if (!m) return
  if (m.completionCheckRetries >= MAX_RETRIES) { await flagMatchToAdmin(params.matchId); await sendButtons(params.customerPhone, 'Thanks for letting us know. Our team will follow up shortly.', [], undefined); return }
  await db.match.update({ where: { id: params.matchId }, data: { completionCheckStatus: 'NO_RESCHEDULED', completionCheckSentAt: new Date() } })
  await sendButtons(params.customerPhone, "Got it — we'll check in again in a few days. Hope the rescheduled job goes well! 👍", [], undefined)
}

export async function handleCompletionCheckWhyNotFinished(params: { matchId: string; customerPhone: string }) {
  const m = await db.match.findUnique({ where: { id: params.matchId }, select: { completionCheckRetries: true } })
  if (!m) return
  if (m.completionCheckRetries >= MAX_RETRIES) { await flagMatchToAdmin(params.matchId); await sendButtons(params.customerPhone, 'Thanks for letting us know. Our team will be in touch to help.', [], undefined); return }
  await db.match.update({ where: { id: params.matchId }, data: { completionCheckStatus: 'NO_NOT_FINISHED', completionCheckSentAt: new Date() } })
  await sendButtons(params.customerPhone, "Noted — we'll follow up in a few days. Feel free to message us if anything changes.", [], undefined)
}

export async function handleCompletionCheckWhyDidntShow(params: { matchId: string; customerPhone: string; providerName: string }) {
  await db.match.update({ where: { id: params.matchId }, data: { completionCheckStatus: 'NO_DIDNT_SHOW' } })
  await Promise.all([
    flagMatchToAdmin(params.matchId),
    sendAdminEscalation({ reason: 'Provider no-show reported by customer', userPhone: params.customerPhone, context: `matchId=${params.matchId} provider=${params.providerName}` }),
    sendButtons(params.customerPhone, `We're sorry to hear that. We've alerted our team and someone will follow up with you shortly regarding ${params.providerName}.`, [], undefined),
  ])
}

export async function flagMatchToAdmin(matchId: string) {
  await db.match.update({ where: { id: matchId }, data: { completionCheckStatus: 'ADMIN_FLAGGED' } })
  console.warn(`[cc] match ${matchId} flagged for admin review`)
}
