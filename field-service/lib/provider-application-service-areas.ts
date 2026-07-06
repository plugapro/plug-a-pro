// ─── Approval-time service-area resolution ────────────────────────────────────
// PJ-01 (platform audit 2026-07-06): both approval paths called
// syncProviderRecord WITHOUT locationNodeIds, so approved providers ended up
// with zero TechnicianServiceArea rows and were silently unmatchable (the
// matching filter only reads active TSA rows for structured addresses).
//
// This helper resolves the LocationNode ids for a ProviderApplication at
// approval time so they can be passed through to syncProviderRecord /
// upsertStructuredServiceAreas (which applies the matching-region gate:
// nodes outside the active matching regions get INACTIVE rows — approval must
// never widen the matching fence).
//
// Resolution order:
//   1. Registration draft — the PWA / WhatsApp / web-resume flows persist the
//      structured node selection on ProviderApplicationDraft.locationNodeIds
//      (linked via submittedApplicationId). This is the authoritative source.
//   2. Label fallback — legacy applications only carry display labels in
//      serviceAreas[]. Match those case-insensitively against active SUBURB /
//      REGION LocationNode labels; ambiguous labels (same label in multiple
//      nodes) are skipped and reported instead of guessed.

import { normaliseLocationDisplayName } from './location-format'

type LocationNodeRow = {
  id: string
  label: string
  nodeType: string
  slug: string
}

export type ApplicationServiceAreaResolutionClient = {
  providerApplicationDraft?: {
    findFirst: (args: any) => Promise<{ locationNodeIds: string[] } | null>
  }
  locationNode?: {
    findMany: (args: any) => Promise<LocationNodeRow[]>
  }
}

export type ApplicationServiceAreaResolution = {
  locationNodeIds: string[]
  source: 'draft' | 'label_match' | 'none'
  /** Labels that could not be resolved to exactly one active node. */
  unresolvedLabels: string[]
}

const EMPTY_RESOLUTION: ApplicationServiceAreaResolution = {
  locationNodeIds: [],
  source: 'none',
  unresolvedLabels: [],
}

function normalizeLabel(value: string): string {
  return normaliseLocationDisplayName(value).trim().toLowerCase()
}

export async function resolveApplicationLocationNodeIds(
  client: ApplicationServiceAreaResolutionClient,
  input: { applicationId: string; serviceAreas: string[] },
): Promise<ApplicationServiceAreaResolution> {
  if (!client.locationNode?.findMany) return EMPTY_RESOLUTION

  // 1. Draft-linked structured selection (authoritative).
  if (client.providerApplicationDraft?.findFirst) {
    try {
      const draft = await client.providerApplicationDraft.findFirst({
        where: { submittedApplicationId: input.applicationId },
        select: { locationNodeIds: true },
      })
      const draftIds = [...new Set(draft?.locationNodeIds ?? [])].filter(Boolean)
      if (draftIds.length > 0) {
        // Validate against live nodes; stale/inactive ids are dropped rather
        // than passed through (upsertStructuredServiceAreas would skip them
        // anyway, but we want an accurate resolution report).
        const nodes = await client.locationNode.findMany({
          where: { id: { in: draftIds }, active: true },
          select: { id: true, label: true, nodeType: true, slug: true },
        })
        if (nodes.length > 0) {
          return {
            locationNodeIds: nodes.map((n) => n.id),
            source: 'draft',
            unresolvedLabels: [],
          }
        }
      }
    } catch (err) {
      console.warn('[application-service-areas] draft lookup failed; falling back to label match', {
        applicationId: input.applicationId,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  // 2. Label fallback for legacy applications.
  const labels = [...new Set(input.serviceAreas.map(normalizeLabel).filter(Boolean))]
  if (labels.length === 0) return EMPTY_RESOLUTION

  const candidates = await client.locationNode.findMany({
    where: {
      active: true,
      nodeType: { in: ['SUBURB', 'REGION'] },
      label: { in: input.serviceAreas.map((v) => normaliseLocationDisplayName(v)).filter(Boolean), mode: 'insensitive' },
    },
    select: { id: true, label: true, nodeType: true, slug: true },
  })

  const byLabel = new Map<string, LocationNodeRow[]>()
  for (const node of candidates) {
    const key = normalizeLabel(node.label)
    const list = byLabel.get(key) ?? []
    list.push(node)
    byLabel.set(key, list)
  }

  const resolved: string[] = []
  const unresolved: string[] = []
  for (const label of labels) {
    const matches = byLabel.get(label) ?? []
    if (matches.length === 1) {
      resolved.push(matches[0].id)
    } else {
      // 0 matches (unknown label) or >1 (ambiguous across regions): never guess.
      unresolved.push(label)
    }
  }

  return {
    locationNodeIds: [...new Set(resolved)],
    source: resolved.length > 0 ? 'label_match' : 'none',
    unresolvedLabels: unresolved,
  }
}
