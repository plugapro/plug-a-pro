/**
 * Unit tests for CRUDTable selection logic.
 * Uses plain TypeScript / vitest — no DOM required.
 */

// Selection state helpers extracted from CRUDTable behaviour

function toggleRow(
  prev: Set<string>,
  id: string,
  maxSelect?: number,
): Set<string> {
  const next = new Set(prev)
  if (next.has(id)) {
    next.delete(id)
  } else {
    if (maxSelect !== undefined && next.size >= maxSelect) return prev
    next.add(id)
  }
  return next
}

function toggleAll(
  prev: Set<string>,
  allIds: string[],
  maxSelect?: number,
): Set<string> {
  const limit = maxSelect !== undefined ? allIds.slice(0, maxSelect) : allIds
  const allSelected = limit.every((id) => prev.has(id))
  return allSelected ? new Set<string>() : new Set(limit)
}

describe('CRUDTable — selection logic', () => {
  describe('toggleRow', () => {
    it('adds a row that was not selected', () => {
      const next = toggleRow(new Set(), 'a')
      expect(next.has('a')).toBe(true)
    })

    it('removes a row that was already selected', () => {
      const next = toggleRow(new Set(['a']), 'a')
      expect(next.has('a')).toBe(false)
    })

    it('does not add beyond maxSelect', () => {
      const current = new Set(['a', 'b'])
      const next = toggleRow(current, 'c', 2)
      expect(next.has('c')).toBe(false)
      expect(next).toBe(current) // same reference — unchanged
    })

    it('allows adding when under maxSelect', () => {
      const next = toggleRow(new Set(['a']), 'b', 2)
      expect(next.has('b')).toBe(true)
    })
  })

  describe('toggleAll', () => {
    const ids = ['a', 'b', 'c', 'd']

    it('selects all rows when none are selected', () => {
      const next = toggleAll(new Set(), ids)
      expect([...next]).toEqual(ids)
    })

    it('deselects all when all are selected', () => {
      const next = toggleAll(new Set(ids), ids)
      expect(next.size).toBe(0)
    })

    it('respects maxSelect — only takes first N', () => {
      const next = toggleAll(new Set(), ids, 2)
      expect([...next]).toEqual(['a', 'b'])
    })

    it('deselects all when the capped set is already selected', () => {
      const next = toggleAll(new Set(['a', 'b']), ids, 2)
      expect(next.size).toBe(0)
    })
  })
})
