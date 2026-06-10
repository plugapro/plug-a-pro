export const WEST_RAND_PILOT = {
  key: 'west-rand-pilot',
  label: 'West Rand Pilot',
  regionKey: 'jhb_west',

  activeSuburbSlugs: [
    'gauteng__johannesburg__jhb_west__honeydew',
    'gauteng__johannesburg__jhb_west__randpark_ridge',
    'gauteng__johannesburg__jhb_west__constantia_kloof',
    'gauteng__johannesburg__jhb_west__florida',
    'gauteng__johannesburg__jhb_west__bromhof',
    'gauteng__johannesburg__jhb_west__discovery',
    'gauteng__johannesburg__jhb_west__helderkruin',
    'gauteng__johannesburg__jhb_west__little_falls',
  ],

  prioritySuburbSlugs: [
    'gauteng__johannesburg__jhb_west__honeydew',
    'gauteng__johannesburg__jhb_west__randpark_ridge',
    'gauteng__johannesburg__jhb_west__constantia_kloof',
    'gauteng__johannesburg__jhb_west__florida',
  ],

  allowedCategorySlugs: [
    'handyman',
    'painting',
    'plumbing',
    'tiling',
    'carpentry',
    'appliances',
  ],

  electricalThreshold: 3,
} as const

const ACTIVE_SUBURBS = new Set<string>(WEST_RAND_PILOT.activeSuburbSlugs)
const PRIORITY_SUBURBS = new Set<string>(WEST_RAND_PILOT.prioritySuburbSlugs)
const ALLOWED_CATEGORIES = new Set<string>(WEST_RAND_PILOT.allowedCategorySlugs)

export function isPilotSuburbSlug(slug: string | null | undefined): boolean {
  return !!slug && ACTIVE_SUBURBS.has(slug)
}

export function isPilotCategorySlug(slug: string | null | undefined): boolean {
  return !!slug && ALLOWED_CATEGORIES.has(slug)
}

export function isPriorityPilotSuburb(slug: string | null | undefined): boolean {
  return !!slug && PRIORITY_SUBURBS.has(slug)
}
