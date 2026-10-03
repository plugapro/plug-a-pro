import { describe, it, expect } from 'vitest'
import { listRowTitle } from '@/lib/whatsapp-flows/list-row-title'

describe('listRowTitle', () => {
  it('returns a label of exactly 24 characters unchanged', () => {
    const label = 'JHB North / Sandton Area' // 24 chars
    expect(label).toHaveLength(24)
    expect(listRowTitle(label)).toBe(label)
  })

  it('returns a short label unchanged', () => {
    expect(listRowTitle('Gauteng')).toBe('Gauteng')
  })

  it('cuts at the last word boundary that fits and never leaves a dangling connector', () => {
    // "Cape Town CBD & Atlantic Seaboard" → the 23-char head is "Cape Town CBD & Atlanti";
    // last space → "Cape Town CBD &"; dangling "&" stripped → "Cape Town CBD…".
    const out = listRowTitle('Cape Town CBD & Atlantic Seaboard')
    expect(out).toBe('Cape Town CBD…')
    expect(out.length).toBeLessThanOrEqual(24)
  })

  it('keeps an inner connector when a whole word follows it', () => {
    const out = listRowTitle('Gqeberha / Nelson Mandela Bay')
    expect(out).toBe('Gqeberha / Nelson…')
    expect(out.length).toBeLessThanOrEqual(24)
    expect(out).not.toMatch(/[\/&\-–—,:;]…$/)
  })

  it('handles the seeded long labels within the cap and on a word boundary', () => {
    for (const label of ['East London / Buffalo City', 'Gqeberha / Nelson Mandela Bay', 'Bloemfontein / Mangaung', 'Cape Town Northern Suburbs', 'Cape Town Southern Suburbs', 'eMalahleni / Witbank', 'Mbombela / Nelspruit', 'East Rand / Ekurhuleni', 'Pretoria CBD & Central', 'JHB West / Roodepoort', 'JHB South / Soweto', 'Durban CBD & Berea']) {
      const out = listRowTitle(label)
      expect(out.length).toBeLessThanOrEqual(24)
      if (out !== label) {
        expect(out.endsWith('…')).toBe(true)
        expect(out).not.toMatch(/\s…$/)
        expect(out).not.toMatch(/[\/&\-–—,:;]…$/)
        // The kept part must be a prefix of the label ending on a whole word.
        const kept = out.slice(0, -1)
        expect(label.startsWith(kept)).toBe(true)
        expect(label.charAt(kept.length)).toMatch(/[\s\/&\-–—,:;]/)
      }
    }
  })

  it('falls back to a hard cut when a single word is longer than the cap', () => {
    const out = listRowTitle('Supercalifragilisticexpialidocious')
    expect(out).toBe('Supercalifragilisticexp…')
    expect(out).toHaveLength(24)
  })

  it('honours a custom max', () => {
    // max 20 → 19-char head "Cape Town CBD & Atl" → last space → "Cape Town CBD &" → connector stripped.
    expect(listRowTitle('Cape Town CBD & Atlantic Seaboard', 20)).toBe('Cape Town CBD…')
    expect(listRowTitle('Durban North', 20)).toBe('Durban North')
  })

  it('keeps a word that ends exactly at the last slot before the ellipsis', () => {
    // "Abcdefghij Klmnopqrstuv" is 23 chars (max - 1) and is followed by a space.
    const out = listRowTitle('Abcdefghij Klmnopqrstuv Wxyz')
    expect(out).toBe('Abcdefghij Klmnopqrstuv…')
    expect(out).toHaveLength(24)
  })

  it('never splits a surrogate pair on a hard cut', () => {
    const out = listRowTitle('Abcdefghijklmnopqrstuv🔔🔔🔔')
    expect([...out].length).toBeLessThanOrEqual(24)
    // No lone surrogate anywhere in the result.
    expect(out).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/)
    expect(out.endsWith('…')).toBe(true)
  })

  it('never exceeds a tiny max', () => {
    expect([...listRowTitle('Johannesburg', 1)].length).toBeLessThanOrEqual(1)
    expect([...listRowTitle('Johannesburg', 0)].length).toBeLessThanOrEqual(0)
    expect([...listRowTitle('Johannesburg', 2)].length).toBeLessThanOrEqual(2)
  })
})
