const norm = (v: string) => v.trim().toLowerCase()

type NodeRow = { id: string; label: string; slug: string; regionKey: string | null; provinceKey: string | null; cityKey: string | null }

export type ResolveServiceAreaLabelsResult = {
  resolvedNodeIds: string[]
  unresolved: string[]
  ambiguous: string[]
}

export async function resolveServiceAreaLabels(
  client: { locationNode: { findMany: (...args: any[]) => Promise<NodeRow[]> } },
  labels: string[],
  opts?: { nodeType?: string; preferMajorityRegion?: boolean },
): Promise<ResolveServiceAreaLabelsResult> {
  const nodeType = opts?.nodeType ?? 'SUBURB'
  const nodes = await client.locationNode.findMany({
    where: { active: true, nodeType },
    select: { id: true, label: true, slug: true, regionKey: true, provinceKey: true, cityKey: true },
  })
  const byLabel = new Map<string, NodeRow[]>()
  for (const n of nodes) {
    const key = norm(n.label)
    const list = byLabel.get(key) ?? []
    list.push(n)
    byLabel.set(key, list)
  }

  // majority region among unambiguous label matches (tiebreak source)
  const regionCounts = new Map<string, number>()
  for (const raw of labels) {
    const ms = byLabel.get(norm(raw)) ?? []
    if (ms.length === 1 && ms[0].regionKey) {
      regionCounts.set(ms[0].regionKey, (regionCounts.get(ms[0].regionKey) ?? 0) + 1)
    }
  }
  let majorityRegion: string | null = null
  let majorityCount = 0
  for (const [region, count] of regionCounts) {
    if (count > majorityCount) { majorityRegion = region; majorityCount = count }
  }

  const resolved = new Set<string>()
  const unresolved: string[] = []
  const ambiguous: string[] = []
  for (const raw of labels) {
    const matches = byLabel.get(norm(raw)) ?? []
    if (matches.length === 0) { unresolved.push(raw); continue }
    let node: NodeRow | null = null
    if (matches.length === 1) {
      node = matches[0]
    } else if (opts?.preferMajorityRegion && majorityRegion) {
      const sameRegion = matches.filter((m) => m.regionKey === majorityRegion)
      if (sameRegion.length === 1) node = sameRegion[0]
    }
    if (!node) { ambiguous.push(raw); continue }
    resolved.add(node.id)
  }
  return { resolvedNodeIds: [...resolved], unresolved, ambiguous }
}
