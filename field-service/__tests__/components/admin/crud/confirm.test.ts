/**
 * Unit tests for DestructiveConfirmDialog guard logic.
 * Validates the isMatch predicate and handleConfirm guard in isolation.
 */

// Mirror the guard logic from DestructiveConfirmDialog

function isMatch(typed: string, confirmText: string): boolean {
  return typed === confirmText
}

async function handleConfirm(
  typed: string,
  confirmText: string,
  onConfirm: () => Promise<void>,
): Promise<'skipped' | 'executed'> {
  if (!isMatch(typed, confirmText)) return 'skipped'
  await onConfirm()
  return 'executed'
}

describe('DestructiveConfirmDialog - confirm guard', () => {
  it('returns false for empty input', () => {
    expect(isMatch('', 'delete-me')).toBe(false)
  })

  it('returns false for partial match', () => {
    expect(isMatch('delete', 'delete-me')).toBe(false)
  })

  it('returns false for case mismatch', () => {
    expect(isMatch('Delete-Me', 'delete-me')).toBe(false)
  })

  it('returns true for exact match', () => {
    expect(isMatch('delete-me', 'delete-me')).toBe(true)
  })

  it('does not call onConfirm when typed does not match', async () => {
    const spy = vi.fn().mockResolvedValue(undefined)
    const result = await handleConfirm('wrong', 'correct', spy)
    expect(spy).not.toHaveBeenCalled()
    expect(result).toBe('skipped')
  })

  it('calls onConfirm when typed matches exactly', async () => {
    const spy = vi.fn().mockResolvedValue(undefined)
    const result = await handleConfirm('correct', 'correct', spy)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(result).toBe('executed')
  })

  it('does not call onConfirm with extra trailing space', async () => {
    const spy = vi.fn().mockResolvedValue(undefined)
    const result = await handleConfirm('correct ', 'correct', spy)
    expect(spy).not.toHaveBeenCalled()
    expect(result).toBe('skipped')
  })
})
