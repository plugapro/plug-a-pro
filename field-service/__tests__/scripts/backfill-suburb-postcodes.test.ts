import { describe, it, expect, vi } from 'vitest'
import {
  listSuburbsMissingPostcodes,
  resolvePostcodes,
  renderPostalCodesFile,
  type MissingSuburb,
} from '../../scripts/backfill-suburb-postcodes'
import { SUBURB_POSTAL_CODES } from '../../lib/service-areas/postal-codes'

const noSleep = async () => {}

describe('listSuburbsMissingPostcodes', () => {
  it('returns every taxonomy suburb slug absent from the known map, sorted, with its coordinates', () => {
    const missing = listSuburbsMissingPostcodes({})
    expect(missing.length).toBeGreaterThan(200)
    expect(missing.map((m) => m.slug)).toEqual([...missing.map((m) => m.slug)].sort())
    const florida = missing.find((m) => m.slug === 'gauteng__johannesburg__jhb_west__florida')
    expect(florida).toEqual({
      slug: 'gauteng__johannesburg__jhb_west__florida',
      label: 'Florida',
      point: { lat: expect.any(Number), lng: expect.any(Number) },
    })
  })

  it('skips slugs that already have a postcode', () => {
    // Drop one known slug so the assertion holds after the backfill too.
    const known = { ...SUBURB_POSTAL_CODES }
    delete known['mpumalanga__mbombela__mbombela__white_river']
    const missing = listSuburbsMissingPostcodes(known)
    expect(missing.some((m) => m.slug in known)).toBe(false)
    // Multi-word labels use the seed slug rule (lowercase, non-alphanumerics → "_")
    expect(missing.map((m) => m.slug)).toContain('mpumalanga__mbombela__mbombela__white_river')
  })

  it('leaves no taxonomy suburb without a postcode in the live map', () => {
    // A new taxonomy suburb without a postcode is hidden from every picker;
    // fail CI until it is backfilled.
    expect(listSuburbsMissingPostcodes()).toEqual([])
  })
})

describe('resolvePostcodes', () => {
  const missing: MissingSuburb[] = [
    { slug: 'a__a__a__one', label: 'One', point: { lat: -26, lng: 28 } },
    { slug: 'a__a__a__two', label: 'Two', point: { lat: -27, lng: 29 } },
    { slug: 'a__a__a__three', label: 'Three', point: { lat: -28, lng: 30 } },
    { slug: 'a__a__a__four', label: 'Four', point: { lat: -29, lng: 31 } },
  ]

  it('keeps 4-digit postcodes, lists the rest as unresolved, and never calls the network itself', async () => {
    const geocode = vi
      .fn()
      .mockResolvedValueOnce({ street: null, suburb: 'One', city: null, province: null, postalCode: '1234' })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ street: null, suburb: 'Three', city: null, province: null, postalCode: '12' })
      .mockResolvedValueOnce({ street: null, suburb: 'Four', city: null, province: null, postalCode: ' 0299 ' })
    const sleep = vi.fn(noSleep)

    const result = await resolvePostcodes(missing, geocode, sleep, 1100)

    expect(result.resolved).toEqual({ a__a__a__one: '1234', a__a__a__four: '0299' })
    expect(result.unresolved).toEqual(['a__a__a__two', 'a__a__a__three'])
    expect(geocode).toHaveBeenCalledTimes(4)
    expect(geocode).toHaveBeenNthCalledWith(1, { lat: -26, lng: 28 })
  })

  it('sleeps between calls (Nominatim 1 req/s) but not after the last one', async () => {
    const geocode = vi.fn().mockResolvedValue({ street: null, suburb: null, city: null, province: null, postalCode: '1000' })
    const sleep = vi.fn(noSleep)
    await resolvePostcodes(missing, geocode, sleep, 1100)
    expect(sleep).toHaveBeenCalledTimes(3)
    expect(sleep).toHaveBeenCalledWith(1100)
  })
})

describe('renderPostalCodesFile', () => {
  it('keeps the header, preserves insertion order and marks manual ones', () => {
    const out = renderPostalCodesFile(
      { 'z__z__z__zed': '9999', 'a__a__a__alpha': '1000', 'm__m__m__mid': '5000' },
      new Set(['m__m__m__mid']),
    )
    expect(out.startsWith('// Generated from the Plug A Pro suburb taxonomy via reverse geocoding of\n')).toBe(true)
    expect(out).toContain('export const SUBURB_POSTAL_CODES: Record<string, string> = {\n')
    const body = out.slice(out.indexOf('{\n') + 2)
    expect(body).toBe(
      '  "z__z__z__zed": "9999",\n' +
        '  "a__a__a__alpha": "1000",\n' +
        '  "m__m__m__mid": "5000", // manual\n' +
        '}\n',
    )
  })

  it('round-trips the current file content exactly when given its own entries', async () => {
    const { readFileSync } = await import('node:fs')
    const { POSTAL_CODES_PATH } = await import('../../scripts/backfill-suburb-postcodes')
    const current = readFileSync(POSTAL_CODES_PATH, 'utf8')
    const manual = new Set(
      [...current.matchAll(/^\s+"([^"]+)": "\d{4}", \/\/ manual$/gm)].map((m) => m[1]),
    )
    expect(renderPostalCodesFile(SUBURB_POSTAL_CODES, manual)).toBe(current)
  })
})
