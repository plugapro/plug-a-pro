// ─── South Africa geographic reference ────────────────────────────────────────
// Canonical lat/lng coordinates for SA suburbs, grouped by province → region.
// Used by the geocoding utility to resolve addresses without an external API.
//
// Coverage: Gauteng (complete), other provinces (major cities only).
// Extend each province as the marketplace grows.

export interface SuburbCoord {
  lat: number
  lng: number
}

export interface Region {
  name: string
  center: SuburbCoord
  /** Approximate radius of this region in km — used as a hint for matching */
  radiusKm: number
  suburbs: Record<string, SuburbCoord>
}

export interface Province {
  name: string
  regions: Record<string, Region>
}

// ─── Gauteng ──────────────────────────────────────────────────────────────────
// Divided into 10 regions so a provider in JHB South is never matched to
// a job in Pretoria North (>50 km apart).

const GAUTENG: Province = {
  name: 'Gauteng',
  regions: {
    jhb_north: {
      name: 'JHB North / Sandton',
      center: { lat: -26.0940, lng: 28.0380 },
      radiusKm: 20,
      suburbs: {
        'sandton':          { lat: -26.1076, lng: 28.0567 },
        'fourways':         { lat: -26.0181, lng: 28.0124 },
        'bryanston':        { lat: -26.0628, lng: 28.0187 },
        'rivonia':          { lat: -26.0580, lng: 28.0633 },
        'randburg':         { lat: -26.0940, lng: 27.9997 },
        'northcliff':       { lat: -26.1484, lng: 27.9502 },
        'linden':           { lat: -26.1412, lng: 28.0039 },
        'greenside':        { lat: -26.1570, lng: 28.0126 },
        'parkhurst':        { lat: -26.1597, lng: 28.0176 },
        'rosebank':         { lat: -26.1456, lng: 28.0431 },
        'melrose':          { lat: -26.1435, lng: 28.0657 },
        'illovo':           { lat: -26.1279, lng: 28.0614 },
        'hyde park':        { lat: -26.1198, lng: 28.0398 },
        'craighall':        { lat: -26.1122, lng: 28.0153 },
        'morningside':      { lat: -26.1048, lng: 28.0709 },
        'sunninghill':      { lat: -26.0421, lng: 28.0680 },
        'woodmead':         { lat: -26.0564, lng: 28.0944 },
        'paulshof':         { lat: -26.0406, lng: 28.0895 },
        'douglasdale':      { lat: -26.0250, lng: 28.0134 },
        'dainfern':         { lat: -25.9956, lng: 28.0200 },
        'cosmo city':       { lat: -26.0213, lng: 27.9264 },
        'honeydew':         { lat: -26.0660, lng: 27.9437 },
      },
    },

    jhb_cbd: {
      name: 'JHB CBD & Inner City',
      center: { lat: -26.2041, lng: 28.0473 },
      radiusKm: 12,
      suburbs: {
        'johannesburg':       { lat: -26.2041, lng: 28.0473 },
        'johannesburg cbd':   { lat: -26.2041, lng: 28.0473 },
        'joburg cbd':         { lat: -26.2041, lng: 28.0473 },
        'braamfontein':       { lat: -26.1936, lng: 28.0387 },
        'newtown':            { lat: -26.2028, lng: 28.0397 },
        'marshalltown':       { lat: -26.2077, lng: 28.0527 },
        'fordsburg':          { lat: -26.2122, lng: 28.0323 },
        'mayfair':            { lat: -26.2219, lng: 28.0278 },
        'crown mines':        { lat: -26.2250, lng: 28.0127 },
        'hillbrow':           { lat: -26.1876, lng: 28.0530 },
        'yeoville':           { lat: -26.1869, lng: 28.0742 },
        'berea':              { lat: -26.1961, lng: 28.0643 },
        'doornfontein':       { lat: -26.2025, lng: 28.0673 },
        'jeppestown':         { lat: -26.2039, lng: 28.0728 },
        'observatory':        { lat: -26.1764, lng: 28.0767 },
        'parktown':           { lat: -26.1874, lng: 28.0416 },
        'westdene':           { lat: -26.1768, lng: 27.9990 },
        'auckland park':      { lat: -26.1838, lng: 28.0041 },
        'melville':           { lat: -26.1901, lng: 27.9964 },
        'sophiatown':         { lat: -26.1879, lng: 27.9990 },
        'westbury':           { lat: -26.2047, lng: 27.9877 },
        'newlands':           { lat: -26.2143, lng: 28.0003 },
        'crosby':             { lat: -26.2239, lng: 27.9776 },
        'vrededorp':          { lat: -26.2015, lng: 28.0176 },
        'richmond':           { lat: -26.2263, lng: 28.0031 },
      },
    },

    jhb_south: {
      name: 'JHB South / Soweto',
      center: { lat: -26.2674, lng: 27.8794 },
      radiusKm: 22,
      suburbs: {
        'soweto':               { lat: -26.2674, lng: 27.8588 },
        'lenasia':              { lat: -26.3197, lng: 27.8299 },
        'lenasia south':        { lat: -26.3373, lng: 27.8201 },
        'johannesburg south':   { lat: -26.2674, lng: 27.8588 },
        'joburg south':         { lat: -26.2674, lng: 27.8588 },
        'turffontein':          { lat: -26.2515, lng: 28.0426 },
        'bassonia':             { lat: -26.2974, lng: 28.0501 },
        'crown gardens':        { lat: -26.2683, lng: 28.0143 },
        'liefde en vrede':      { lat: -26.2889, lng: 28.0344 },
        'rosettenville':        { lat: -26.2592, lng: 28.0568 },
        'glenanda':             { lat: -26.2940, lng: 28.0417 },
        'ormonde':              { lat: -26.2482, lng: 27.9924 },
        'eldorado park':        { lat: -26.2968, lng: 27.9167 },
        'ennerdale':            { lat: -26.3466, lng: 27.8830 },
        'naturena':             { lat: -26.3153, lng: 27.9479 },
        'kibler park':          { lat: -26.3233, lng: 28.0168 },
        'mulbarton':            { lat: -26.3197, lng: 28.0420 },
        'glenvista':            { lat: -26.3156, lng: 28.0636 },
        'alberton':             { lat: -26.2659, lng: 28.1222 },
        'brackenhurst':         { lat: -26.3023, lng: 28.1244 },
        'meyersdal':            { lat: -26.3166, lng: 28.1019 },
      },
    },

    jhb_east: {
      name: 'JHB East',
      center: { lat: -26.1631, lng: 28.1550 },
      radiusKm: 18,
      suburbs: {
        'edenvale':       { lat: -26.1310, lng: 28.1619 },
        'bedfordview':    { lat: -26.1848, lng: 28.1442 },
        'germiston':      { lat: -26.2141, lng: 28.1654 },
        'eastgate':       { lat: -26.1639, lng: 28.1253 },
        'sandringham':    { lat: -26.1635, lng: 28.0960 },
        'kensington':     { lat: -26.1894, lng: 28.0961 },
        'bezuidenhout valley': { lat: -26.1988, lng: 28.0842 },
        'highlands north': { lat: -26.1746, lng: 28.0905 },
        'orange grove':   { lat: -26.1735, lng: 28.0769 },
        'houghton':       { lat: -26.1638, lng: 28.0719 },
        'saxonwold':      { lat: -26.1584, lng: 28.0583 },
        'linksfield':     { lat: -26.1530, lng: 28.1119 },
        'bramley':        { lat: -26.1330, lng: 28.0861 },
        'dowerglen':      { lat: -26.1379, lng: 28.1357 },
        'modderfontein':  { lat: -26.1072, lng: 28.1698 },
        'isando':         { lat: -26.1430, lng: 28.1967 },
        'elandsfontein':  { lat: -26.1725, lng: 28.2054 },
      },
    },

    jhb_west: {
      name: 'JHB West / Roodepoort',
      center: { lat: -26.1568, lng: 27.8900 },
      radiusKm: 20,
      suburbs: {
        'roodepoort':     { lat: -26.1644, lng: 27.8730 },
        'florida':        { lat: -26.1681, lng: 27.9174 },
        'weltevreden park': { lat: -26.1157, lng: 27.9279 },
        'strubensvalley': { lat: -26.1013, lng: 27.8884 },
        'johannesburg west': { lat: -26.1644, lng: 27.8730 },
        'joburg west':    { lat: -26.1644, lng: 27.8730 },
        'discovery':      { lat: -26.1389, lng: 27.8743 },
        'ruimsig':        { lat: -26.1007, lng: 27.8671 },
        'little falls':   { lat: -26.0826, lng: 27.9282 },
        'radiokop':       { lat: -26.0929, lng: 27.9155 },
        'bromhof':        { lat: -26.0725, lng: 27.9604 },
        'randpark ridge': { lat: -26.0878, lng: 27.9782 },
        'wilgeheuwel':    { lat: -26.0723, lng: 27.9063 },
      },
    },

    east_rand: {
      name: 'East Rand / Ekurhuleni',
      center: { lat: -26.1316, lng: 28.2706 },
      radiusKm: 22,
      suburbs: {
        'kempton park':   { lat: -26.0991, lng: 28.2281 },
        'tembisa':        { lat: -26.0018, lng: 28.2207 },
        'boksburg':       { lat: -26.2088, lng: 28.2556 },
        'benoni':         { lat: -26.1851, lng: 28.3175 },
        'brakpan':        { lat: -26.2351, lng: 28.3703 },
        'springs':        { lat: -26.2496, lng: 28.4417 },
        'daveyton':       { lat: -26.1467, lng: 28.3920 },
        'katlehong':      { lat: -26.3249, lng: 28.1710 },
        'thokoza':        { lat: -26.3491, lng: 28.1847 },
        'vosloorus':      { lat: -26.3444, lng: 28.2213 },
        'etwatwa':        { lat: -26.1665, lng: 28.4256 },
        'dunnottar':      { lat: -26.3296, lng: 28.5028 },
        'nigel':          { lat: -26.4154, lng: 28.4840 },
        'heidelberg':     { lat: -26.5048, lng: 28.3610 },
        'ekurhuleni':     { lat: -26.1316, lng: 28.2706 },
      },
    },

    centurion_midrand: {
      name: 'Centurion / Midrand',
      center: { lat: -25.9006, lng: 28.1560 },
      radiusKm: 25,
      suburbs: {
        'midrand':        { lat: -25.9006, lng: 28.1277 },
        'centurion':      { lat: -25.8603, lng: 28.1888 },
        'halfway house':  { lat: -25.9759, lng: 28.1268 },
        'irene':          { lat: -25.8940, lng: 28.2239 },
        'waterfall':      { lat: -25.9500, lng: 28.1200 },
        'kyalami':        { lat: -25.9774, lng: 28.0638 },
        'glen austin':    { lat: -25.9474, lng: 28.1697 },
        'noordwyk':       { lat: -25.9201, lng: 28.1371 },
        'bredell':        { lat: -26.0119, lng: 28.1820 },
        'lonehill':       { lat: -26.0095, lng: 28.0328 },
        'blue hills':     { lat: -25.9337, lng: 28.1581 },
        'tembisa south':  { lat: -26.0360, lng: 28.1756 },
      },
    },

    pretoria_east: {
      name: 'Pretoria East',
      center: { lat: -25.7900, lng: 28.3000 },
      radiusKm: 20,
      suburbs: {
        'menlyn':         { lat: -25.7900, lng: 28.2766 },
        'lynnwood':       { lat: -25.7753, lng: 28.3020 },
        'garsfontein':    { lat: -25.8127, lng: 28.3240 },
        'faerie glen':    { lat: -25.7812, lng: 28.3140 },
        'waterkloof':     { lat: -25.7938, lng: 28.2597 },
        'waterkloof ridge': { lat: -25.7963, lng: 28.2718 },
        'moreleta park':  { lat: -25.8235, lng: 28.3127 },
        'equestria':      { lat: -25.8054, lng: 28.3264 },
        'silver lakes':   { lat: -25.8024, lng: 28.3724 },
        'willow acres':   { lat: -25.7820, lng: 28.3892 },
        'woodhill':       { lat: -25.8235, lng: 28.3531 },
        'olympus':        { lat: -25.7734, lng: 28.3382 },
        'pretoria east':  { lat: -25.7900, lng: 28.3000 },
      },
    },

    pretoria_cbd: {
      name: 'Pretoria CBD & Central',
      center: { lat: -25.7462, lng: 28.1882 },
      radiusKm: 15,
      suburbs: {
        'arcadia':        { lat: -25.7462, lng: 28.1882 },
        'hatfield':       { lat: -25.7465, lng: 28.2208 },
        'sunnyside':      { lat: -25.7604, lng: 28.2123 },
        'brooklyn':       { lat: -25.7620, lng: 28.2280 },
        'pretoria':       { lat: -25.7479, lng: 28.1878 },
        'pretoria cbd':   { lat: -25.7479, lng: 28.1878 },
        'new muckleneuk': { lat: -25.7802, lng: 28.2168 },
        'muckleneuk':     { lat: -25.7736, lng: 28.2038 },
        'groenkloof':     { lat: -25.7893, lng: 28.1918 },
        'colbyn':         { lat: -25.7295, lng: 28.2221 },
        'clydesdale':     { lat: -25.7507, lng: 28.2036 },
        'ashlea gardens': { lat: -25.7698, lng: 28.2427 },
        'erasmuskloof':   { lat: -25.8001, lng: 28.2379 },
        'elardus park':   { lat: -25.8230, lng: 28.2638 },
      },
    },

    pretoria_north: {
      name: 'Pretoria North',
      center: { lat: -25.6714, lng: 28.1700 },
      radiusKm: 20,
      suburbs: {
        'wonderboom':     { lat: -25.6714, lng: 28.1847 },
        'akasia':         { lat: -25.6595, lng: 28.1508 },
        'pretoria north': { lat: -25.6832, lng: 28.1744 },
        'rosslyn':        { lat: -25.6539, lng: 28.1056 },
        'ga-rankuwa':     { lat: -25.6264, lng: 28.0040 },
        'mabopane':       { lat: -25.5822, lng: 28.0544 },
        'soshanguve':     { lat: -25.5267, lng: 28.0980 },
        'doornpoort':     { lat: -25.6601, lng: 28.2073 },
        'eersterust':     { lat: -25.6954, lng: 28.3001 },
        'mamelodi':       { lat: -25.7237, lng: 28.3604 },
        'nellmapius':     { lat: -25.7393, lng: 28.3460 },
      },
    },
  },
}

// ─── Western Cape ─────────────────────────────────────────────────────────────
const WESTERN_CAPE: Province = {
  name: 'Western Cape',
  regions: {
    cape_town_north: {
      name: 'Cape Town Northern Suburbs',
      center: { lat: -33.8650, lng: 18.6300 },
      radiusKm: 20,
      suburbs: {
        'bellville':    { lat: -33.9167, lng: 18.6333 },
        'parow':        { lat: -33.9053, lng: 18.5980 },
        'goodwood':     { lat: -33.9202, lng: 18.5527 },
        'tygervalley':  { lat: -33.8650, lng: 18.6300 },
        'durbanville':  { lat: -33.8319, lng: 18.6476 },
        'brackenfell':  { lat: -33.8749, lng: 18.6861 },
        'kuils river':  { lat: -33.9265, lng: 18.6965 },
      },
    },
    cape_town_south: {
      name: 'Cape Town Southern Suburbs',
      center: { lat: -33.9698, lng: 18.4637 },
      radiusKm: 15,
      suburbs: {
        'claremont':    { lat: -33.9860, lng: 18.4700 },
        'rondebosch':   { lat: -33.9680, lng: 18.4756 },
        'kenilworth':   { lat: -33.9994, lng: 18.4775 },
        'wynberg':      { lat: -34.0105, lng: 18.4756 },
        'plumstead':    { lat: -34.0162, lng: 18.4726 },
        'diep river':   { lat: -34.0337, lng: 18.4728 },
        'tokai':        { lat: -34.0564, lng: 18.4532 },
      },
    },
    cape_town_cbd: {
      name: 'Cape Town CBD & Atlantic Seaboard',
      center: { lat: -33.9249, lng: 18.4241 },
      radiusKm: 12,
      suburbs: {
        'cape town':          { lat: -33.9249, lng: 18.4241 },
        'cape town cbd':      { lat: -33.9249, lng: 18.4241 },
        'gardens':            { lat: -33.9360, lng: 18.4185 },
        'de waterkant':       { lat: -33.9227, lng: 18.4202 },
        'sea point':          { lat: -33.9182, lng: 18.3960 },
        'green point':        { lat: -33.9127, lng: 18.4109 },
        'mouille point':      { lat: -33.9049, lng: 18.4063 },
        'fresnaye':           { lat: -33.9202, lng: 18.3896 },
        'three anchor bay':   { lat: -33.9101, lng: 18.4000 },
        'woodstock':          { lat: -33.9282, lng: 18.4502 },
        'observatory':        { lat: -33.9411, lng: 18.4711 },
      },
    },
  },
}

// ─── KwaZulu-Natal ────────────────────────────────────────────────────────────
const KWAZULU_NATAL: Province = {
  name: 'KwaZulu-Natal',
  regions: {
    durban_north: {
      name: 'Durban North',
      center: { lat: -29.8100, lng: 31.0200 },
      radiusKm: 20,
      suburbs: {
        'umhlanga':       { lat: -29.7245, lng: 31.0859 },
        'la lucia':       { lat: -29.7607, lng: 31.0557 },
        'durban north':   { lat: -29.7889, lng: 31.0425 },
        'ballito':        { lat: -29.5350, lng: 31.2060 },
        'umdloti':        { lat: -29.6770, lng: 31.1140 },
      },
    },
    durban_cbd: {
      name: 'Durban CBD & Berea',
      center: { lat: -29.8587, lng: 31.0218 },
      radiusKm: 15,
      suburbs: {
        'durban':         { lat: -29.8587, lng: 31.0218 },
        'durban cbd':     { lat: -29.8587, lng: 31.0218 },
        'morningside':    { lat: -29.8375, lng: 31.0100 },
        'berea':          { lat: -29.8517, lng: 30.9967 },
        'musgrave':       { lat: -29.8565, lng: 30.9985 },
        'glenwood':       { lat: -29.8762, lng: 30.9935 },
        'overport':       { lat: -29.8463, lng: 30.9805 },
        'westville':      { lat: -29.8438, lng: 30.9369 },
      },
    },
  },
}

// ─── Public exports ───────────────────────────────────────────────────────────

export const SA_PROVINCES: Record<string, Province> = {
  gauteng:       GAUTENG,
  western_cape:  WESTERN_CAPE,
  kwazulu_natal: KWAZULU_NATAL,
}

/** Flat lookup: normalised suburb name → { lat, lng, region, province } */
const _suburbIndex: Map<string, SuburbCoord & { region: string; province: string }> = new Map()

for (const [provinceKey, province] of Object.entries(SA_PROVINCES)) {
  for (const [regionKey, region] of Object.entries(province.regions)) {
    for (const [suburb, coord] of Object.entries(region.suburbs)) {
      _suburbIndex.set(suburb.toLowerCase().trim(), {
        ...coord,
        region: regionKey,
        province: provinceKey,
      })
    }
    // Also index the region name itself → region center
    _suburbIndex.set(region.name.toLowerCase().trim(), {
      ...region.center,
      region: regionKey,
      province: provinceKey,
    })
  }
}

/**
 * Look up coordinates for a suburb / city name.
 * Returns null if the suburb is not in the static reference.
 */
export function lookupSuburb(suburb: string): (SuburbCoord & { region: string; province: string }) | null {
  return _suburbIndex.get(suburb.toLowerCase().trim()) ?? null
}

/**
 * Returns all regions for a given province with their center coordinates
 * and radius — useful for populating provider service area dropdowns.
 */
export function getProvinceRegions(province: 'gauteng' | 'western_cape' | 'kwazulu_natal') {
  const p = SA_PROVINCES[province]
  if (!p) return []
  return Object.entries(p.regions).map(([key, r]) => ({
    key,
    name: r.name,
    center: r.center,
    radiusKm: r.radiusKm,
    suburbCount: Object.keys(r.suburbs).length,
  }))
}

/**
 * Maps each regionKey to the city/metro it belongs to.
 * Used by the seed script to build the 4-level Province → City → Region → Suburb hierarchy.
 * NOT for UI use — UI reads from DB via lib/location-nodes.ts.
 */
export const REGION_CITY_MAP: Record<string, { cityKey: string; cityLabel: string }> = {
  // Gauteng
  jhb_north:         { cityKey: 'johannesburg',      cityLabel: 'Johannesburg' },
  jhb_cbd:           { cityKey: 'johannesburg',      cityLabel: 'Johannesburg' },
  jhb_south:         { cityKey: 'johannesburg',      cityLabel: 'Johannesburg' },
  jhb_east:          { cityKey: 'johannesburg',      cityLabel: 'Johannesburg' },
  jhb_west:          { cityKey: 'johannesburg',      cityLabel: 'Johannesburg' },
  east_rand:         { cityKey: 'east_rand',         cityLabel: 'East Rand / Ekurhuleni' },
  centurion_midrand: { cityKey: 'centurion_midrand', cityLabel: 'Centurion / Midrand' },
  pretoria_east:     { cityKey: 'pretoria',          cityLabel: 'Pretoria' },
  pretoria_cbd:      { cityKey: 'pretoria',          cityLabel: 'Pretoria' },
  pretoria_north:    { cityKey: 'pretoria',          cityLabel: 'Pretoria' },
  // Western Cape
  cape_town_north:   { cityKey: 'cape_town',         cityLabel: 'Cape Town' },
  cape_town_south:   { cityKey: 'cape_town',         cityLabel: 'Cape Town' },
  cape_town_cbd:     { cityKey: 'cape_town',         cityLabel: 'Cape Town' },
  // KwaZulu-Natal
  durban_north:      { cityKey: 'durban',            cityLabel: 'Durban' },
  durban_cbd:        { cityKey: 'durban',            cityLabel: 'Durban' },
}

/**
 * Maps provinceKey to the cities/metros within that province.
 * Used by the seed script only.
 * NOT for UI use — UI reads from DB via lib/location-nodes.ts.
 */
export const PROVINCE_CITIES: Record<string, Array<{ key: string; label: string }>> = {
  gauteng: [
    { key: 'johannesburg',      label: 'Johannesburg' },
    { key: 'east_rand',         label: 'East Rand / Ekurhuleni' },
    { key: 'centurion_midrand', label: 'Centurion / Midrand' },
    { key: 'pretoria',          label: 'Pretoria' },
  ],
  western_cape: [
    { key: 'cape_town', label: 'Cape Town' },
  ],
  kwazulu_natal: [
    { key: 'durban', label: 'Durban' },
  ],
}
