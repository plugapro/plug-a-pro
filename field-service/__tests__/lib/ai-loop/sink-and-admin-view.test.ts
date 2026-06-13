import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { createFileSink, createNullSink } from '../../../lib/ai-loop/sink'
import { writeOperationalEvent } from '../../../lib/ai-loop/openbrain-writer'
import {
  generateImprovementCandidates,
  type CandidateEvidenceEvent,
} from '../../../lib/ai-loop/improvement-candidates'
import { buildAdminCandidateView, listImprovementCandidatesForAdmin } from '../../../lib/ai-loop/admin-view'

const now = () => '2026-06-13T12:00:00.000Z'

let tmp: string
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-loop-'))
})
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true })
})

function paymentEvidence(): CandidateEvidenceEvent[] {
  return Array.from({ length: 3 }, (_, i) => ({
    name: 'payment.failed',
    affectedFlow: 'payment',
    entityRefs: { paymentId: `pay_${i}` },
  }))
}

describe('createFileSink', () => {
  it('appends an observation as NDJSON', async () => {
    const sink = createFileSink(tmp)
    await writeOperationalEvent(
      {
        name: 'booking.failed',
        actorType: 'customer',
        occurredAt: now(),
        entityRefs: { jobRequestId: 'creq_1' },
        metadata: { errorCode: 'SLOT_TAKEN' },
      },
      { sink, now },
    )
    const raw = await fs.readFile(path.join(tmp, 'observations', 'observations.ndjson'), 'utf8')
    const parsed = JSON.parse(raw.trim())
    expect(parsed).toMatchObject({ event: 'booking.failed', category: 'booking' })
  })

  it('writes a candidate as NDJSON plus a markdown brief, and lists it back', async () => {
    const sink = createFileSink(tmp)
    const [candidate] = generateImprovementCandidates(paymentEvidence(), { now })
    await sink.writeCandidate(candidate)

    const md = await fs.readFile(path.join(tmp, 'improvement-candidates', `${candidate.id}.md`), 'utf8')
    expect(md).toContain(candidate.title)
    expect(md).toMatch(/Human review required:\*\* YES/)

    const listed = await sink.listCandidates()
    expect(listed).toHaveLength(1)
    expect(listed[0].id).toBe(candidate.id)
  })

  it('listCandidates returns [] when nothing has been written', async () => {
    const sink = createFileSink(tmp)
    expect(await sink.listCandidates()).toEqual([])
  })
})

describe('null sink', () => {
  it('no-ops and lists nothing', async () => {
    const sink = createNullSink()
    await sink.writeObservation({} as never)
    expect(await sink.listCandidates()).toEqual([])
  })
})

describe('admin view', () => {
  it('projects only read-only summary columns (no draft instruction)', () => {
    const candidates = generateImprovementCandidates(paymentEvidence(), { now })
    const rows = buildAdminCandidateView(candidates)
    expect(rows[0]).toMatchObject({
      title: candidates[0].title,
      category: 'payment',
      riskLevel: 'critical',
      humanReviewRequired: true,
    })
    expect(rows[0]).not.toHaveProperty('draftTaskInstruction')
    expect(rows[0]).not.toHaveProperty('metadata')
  })

  it('reads candidates from a sink for the admin endpoint', async () => {
    const sink = createFileSink(tmp)
    const [candidate] = generateImprovementCandidates(paymentEvidence(), { now })
    await sink.writeCandidate(candidate)
    const rows = await listImprovementCandidatesForAdmin(sink)
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe(candidate.id)
  })
})
