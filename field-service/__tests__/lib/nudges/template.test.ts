import { describe, expect, it } from 'vitest'

import {
  buildMissingItemsLabel,
  renderNudgeMessage,
} from '@/lib/nudges/template'

describe('buildMissingItemsLabel', () => {
  it('returns the single item as-is', () => {
    expect(buildMissingItemsLabel(['bank details'])).toBe('bank details')
  })

  it('joins two items with " and " (no serial comma)', () => {
    expect(buildMissingItemsLabel(['name', 'phone number'])).toBe(
      'name and phone number',
    )
  })

  it('joins three+ items with serial comma + and', () => {
    expect(
      buildMissingItemsLabel(['bank details', 'equipment list', 'service areas']),
    ).toBe('bank details, equipment list, and service areas')
  })

  it('falls back to "a few details" for an empty input', () => {
    expect(buildMissingItemsLabel([])).toBe('a few details')
  })
})

describe('renderNudgeMessage', () => {
  it('renders the locked wording with substitutions', () => {
    const message = renderNudgeMessage({
      firstName: 'Sipho',
      missingItemsLabel: 'bank details and equipment list',
    })

    expect(message).toBe(
      'Hi Sipho, thanks again for registering with Plug A Pro. We are preparing the first West Rand pilot jobs and noticed your profile is missing: bank details and equipment list.\n' +
        'We have noticed that providers with a more complete profile are easier for customers to trust and nominate for jobs. Please add these when you have a moment so you can be considered for more suitable leads.',
    )
  })

  it('includes the corrected closing line verbatim', () => {
    const message = renderNudgeMessage({
      firstName: 'X',
      missingItemsLabel: 'a few details',
    })
    expect(message).toContain('so you can be considered for more suitable leads.')
  })

  it('falls back to "there" when firstName is empty', () => {
    const message = renderNudgeMessage({
      firstName: '',
      missingItemsLabel: 'name',
    })
    expect(message.startsWith('Hi there,')).toBe(true)
  })
})
