const LOCATION_NAME_OVERRIDES: Record<string, string> = {
  cbd: 'CBD',
  'jhb cbd': 'JHB CBD',
  'jhb north': 'JHB North',
  'jhb south': 'JHB South',
  'jhb east': 'JHB East',
  'jhb west': 'JHB West',
  'kwazulu-natal': 'KwaZulu-Natal',
  'kwazulu natal': 'KwaZulu-Natal',
  emalahleni: 'eMalahleni',
  umhlanga: 'uMhlanga',
}

const LOWERCASE_PARTICLES = new Set(['of', 'and', 'the'])

function collapseWhitespace(value: string) {
  return value.trim().replace(/\s+/g, ' ')
}

function formatWord(word: string, wordIndex: number) {
  if (!word) return word

  const key = word.toLowerCase()
  const override = LOCATION_NAME_OVERRIDES[key]
  if (override) return override

  if (word === word.toUpperCase() && word.length <= 4) return word
  if (wordIndex > 0 && LOWERCASE_PARTICLES.has(key)) return key

  return word
    .split('-')
    .map((part) => {
      if (!part) return part
      const partKey = part.toLowerCase()
      const partOverride = LOCATION_NAME_OVERRIDES[partKey]
      if (partOverride) return partOverride
      if (part === part.toUpperCase() && part.length <= 4) return part
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()
    })
    .join('-')
}

function formatSegment(segment: string) {
  const cleaned = collapseWhitespace(segment)
  const override = LOCATION_NAME_OVERRIDES[cleaned.toLowerCase()]
  if (override) return override

  return cleaned
    .split(' ')
    .map((word, index) => formatWord(word, index))
    .join(' ')
}

export function normaliseLocationDisplayName(value: string | null | undefined): string {
  if (!value) return ''

  return collapseWhitespace(value)
    .split(',')
    .map(formatSegment)
    .join(', ')
}

export function normaliseLocationDisplayNames(values: string[] | null | undefined): string[] {
  return (values ?? [])
    .map((value) => normaliseLocationDisplayName(value))
    .filter(Boolean)
}

export function normaliseLocationKey(value: string | null | undefined): string {
  return collapseWhitespace(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

// Used internally by consumers that need a pre-normalised locality object.
// Not exported until a second call site exists.
function formatAddressLocality(address: {
  suburb?: string | null
  region?: string | null
  city?: string | null
  province?: string | null
} | null | undefined) {
  return {
    suburb: normaliseLocationDisplayName(address?.suburb),
    region: normaliseLocationDisplayName(address?.region),
    city: normaliseLocationDisplayName(address?.city),
    province: normaliseLocationDisplayName(address?.province),
  }
}
