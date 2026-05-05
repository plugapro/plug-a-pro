// Static seed data for West Rand pilot test leads.
// Edit the IMAGE_MAPPING section after viewing the source images to classify them.

export const COHORT = 'west-rand-pilot-seed' as const

export type CustomerKey = 'masego-mataboge' | 'seth-mataboge' | 'emma-mafoko'

export interface CustomerConfig {
  key: CustomerKey
  name: string
  phone: string           // E.164 normalised
  category: string        // JobRequest.category slug
  title: string
  description: string
  availability: 'urgent' | 'mornings' | 'flexible'
  address: AddressConfig
}

export interface AddressConfig {
  label: string
  street: string
  suburb: string
  city: string
  province: string
  postalCode: string
  lat: number
  lng: number
}

export interface ImageMappingEntry {
  customerKey: CustomerKey
  label: string    // attachment label: 'evidence' | 'before' | 'after'
  caption?: string
}

export const CUSTOMERS: CustomerConfig[] = [
  {
    key: 'masego-mataboge',
    name: 'Masego Mataboge',
    phone: '+27827006695',
    category: 'plumbing',
    title: 'Blocked shower drain',
    description:
      'Blocked shower drain. Water drains slowly and backs up during use.',
    availability: 'urgent',
    address: {
      label: 'Home',
      street: '14 Sunset Road',
      suburb: 'Ruimsig',
      city: 'Roodepoort',
      province: 'Gauteng',
      postalCode: '1724',
      lat: -26.08,
      lng: 27.853,
    },
  },
  {
    key: 'seth-mataboge',
    name: 'Seth Mataboge',
    phone: '+27764010810',
    category: 'plumbing',
    title: 'Geyser leaking',
    description:
      'Geyser leaking. Water visible around the geyser area and needs urgent inspection.',
    availability: 'mornings',
    address: {
      label: 'Home',
      street: '7 Acacia Avenue',
      suburb: 'Wilgeheuwel',
      city: 'Roodepoort',
      province: 'Gauteng',
      postalCode: '1724',
      lat: -26.062,
      lng: 27.908,
    },
  },
  {
    key: 'emma-mafoko',
    name: 'Emma Mafoko',
    phone: '+27824978565',
    category: 'handyman',
    title: 'Light fittings — handyman / electrical',
    description:
      'Light fittings need handyman/electrical help. Some lights are not working and may need replacement or repair.',
    availability: 'flexible',
    address: {
      label: 'Home',
      street: '23 Maple Close',
      suburb: 'Little Falls',
      city: 'Roodepoort',
      province: 'Gauteng',
      postalCode: '1735',
      lat: -26.083,
      lng: 27.917,
    },
  },
]

// ─── Image mapping ────────────────────────────────────────────────────────────
// Keys are UUID filenames WITHOUT the file extension (case-sensitive).
// Fill in this section after viewing the source images in:
//   /Users/shimane/Desktop/defects/plugapro/images
//
// Available customer keys: 'masego-mataboge' | 'seth-mataboge' | 'emma-mafoko'
// Available labels: 'evidence' | 'before' | 'after'
//
// Example entry:
//   '55B6FEAD-AE90-49AB-B9FA-823E994E5B2B': {
//     customerKey: 'masego-mataboge',
//     label: 'evidence',
//     caption: 'Blocked shower drain — standing water',
//   },
//
// Leave this empty to run without image uploads; unclassified images appear
// in the needs_review section of the dry-run report.

export const IMAGE_MAPPING: Record<string, ImageMappingEntry> = {
  '55B6FEAD-AE90-49AB-B9FA-823E994E5B2B': {
    customerKey: 'emma-mafoko',
    label: 'evidence',
    caption: 'LED security light fitting — electrical work',
  },
  '87A345AD-30F3-4EDE-A91D-208E6EA38F0F': {
    customerKey: 'seth-mataboge',
    label: 'evidence',
    caption: 'Geyser — temperature valve replaced',
  },
  'A4AFDD26-F45F-4BA7-80F4-F5DBB37AC471': {
    customerKey: 'masego-mataboge',
    label: 'evidence',
    caption: 'Blocked shower drain — clogged and water not flowing',
  },
  'AD901123-5E38-4259-AEFB-4735644C7D7D': {
    customerKey: 'seth-mataboge',
    label: 'evidence',
    caption: 'Leaking geyser — hot water system leaking near valve connection',
  },
  'B1E5333F-BBD8-4F9D-BEFB-B6CFB547A76B': {
    customerKey: 'masego-mataboge',
    label: 'evidence',
    caption: 'Leaking pipe under sink — plumbing issue',
  },
  'F5A063D4-71E0-4C3C-BE7F-BC9D854EF362': {
    customerKey: 'seth-mataboge',
    label: 'evidence',
    caption: 'Water leak at toilet base — plumbing issue',
  },
}

// ─── Fannie provider lookup ───────────────────────────────────────────────────
// The script searches for a provider whose name contains this string (case-insensitive).
export const FANNIE_NAME_FRAGMENT = 'Fannie'

// ─── Lead timing ─────────────────────────────────────────────────────────────
export const LEAD_TTL_MINUTES = 120     // 2 hours — enough time for manual phone testing
export const REQUEST_EXPIRES_DAYS = 30  // how far in the future the request expires
export const MIN_PROMO_CREDITS = 5      // ensure Fannie has at least this many credits
export const TOP_UP_PROMO_CREDITS = 10  // add this many promo credits if below minimum
