import { describe, it, expect } from 'vitest'
import {
  evidenceStepComplete,
  MIN_EVIDENCE_PHOTOS,
} from '@/lib/provider-onboarding/quality-gate'

describe('evidenceStepComplete', () => {
  describe('gate disabled', () => {
    it('returns true with 0 photos', () => {
      expect(evidenceStepComplete([], false)).toBe(true)
    })

    it('returns true with 1 photo', () => {
      expect(evidenceStepComplete(['https://example.vercel-storage.com/a.jpg'], false)).toBe(true)
    })

    it('returns true with any number of photos', () => {
      const urls = Array.from({ length: 10 }, (_, i) => `https://x.vercel-storage.com/${i}.jpg`)
      expect(evidenceStepComplete(urls, false)).toBe(true)
    })
  })

  describe('gate enabled', () => {
    it('returns false with 0 photos', () => {
      expect(evidenceStepComplete([], true)).toBe(false)
    })

    it(`returns false with fewer than ${MIN_EVIDENCE_PHOTOS} photos`, () => {
      const urls = Array.from({ length: MIN_EVIDENCE_PHOTOS - 1 }, (_, i) => `https://x.vercel-storage.com/${i}.jpg`)
      expect(evidenceStepComplete(urls, true)).toBe(false)
    })

    it(`returns true with exactly ${MIN_EVIDENCE_PHOTOS} photos`, () => {
      const urls = Array.from({ length: MIN_EVIDENCE_PHOTOS }, (_, i) => `https://x.vercel-storage.com/${i}.jpg`)
      expect(evidenceStepComplete(urls, true)).toBe(true)
    })

    it(`returns true with more than ${MIN_EVIDENCE_PHOTOS} photos`, () => {
      const urls = Array.from({ length: MIN_EVIDENCE_PHOTOS + 2 }, (_, i) => `https://x.vercel-storage.com/${i}.jpg`)
      expect(evidenceStepComplete(urls, true)).toBe(true)
    })

    it('ignores duplicate URLs when counting', () => {
      // Only 1 distinct URL repeated MIN_EVIDENCE_PHOTOS times → still insufficient
      const sameUrl = 'https://x.vercel-storage.com/dup.jpg'
      const urls = Array.from({ length: MIN_EVIDENCE_PHOTOS }, () => sameUrl)
      expect(evidenceStepComplete(urls, true)).toBe(false)
    })

    it('ignores blank/whitespace entries when counting', () => {
      const urls = Array.from({ length: MIN_EVIDENCE_PHOTOS - 1 }, (_, i) => `https://x.vercel-storage.com/${i}.jpg`)
      expect(evidenceStepComplete([...urls, '', '  '], true)).toBe(false)
    })
  })
})
