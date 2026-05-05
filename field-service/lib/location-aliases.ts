export const LOCATION_ALIASES: Record<string, string> = {
  gp: 'Gauteng',
  wc: 'Western Cape',
  kzn: 'KwaZulu-Natal',
  ec: 'Eastern Cape',
  fs: 'Free State',
  lp: 'Limpopo',
  mp: 'Mpumalanga',
  nc: 'Northern Cape',
  nw: 'North West',
  joburg: 'Johannesburg',
  jozi: 'Johannesburg',
  tshwane: 'Pretoria',
  ethekwini: 'Durban',
  'e thekwini': 'Durban',
  'jhb west': 'JHB West / Roodepoort',
  'joburg west': 'JHB West / Roodepoort',
  'johannesburg west': 'JHB West / Roodepoort',
  roodepoort: 'Roodepoort',
}

export function locationSearchTerms(query: string): string[] {
  const trimmed = query.trim()
  const alias = LOCATION_ALIASES[trimmed.toLowerCase()]
  const extra = trimmed.toLowerCase().includes('jhb west') ||
    trimmed.toLowerCase().includes('joburg west') ||
    trimmed.toLowerCase().includes('johannesburg west')
    ? ['Roodepoort']
    : []
  return [...new Set([trimmed, alias, ...extra].filter((value): value is string => Boolean(value)))]
}
