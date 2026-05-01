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
        'Sandton':          { lat: -26.1076, lng: 28.0567 },
        'Fourways':         { lat: -26.0181, lng: 28.0124 },
        'Bryanston':        { lat: -26.0628, lng: 28.0187 },
        'Rivonia':          { lat: -26.0580, lng: 28.0633 },
        'Randburg':         { lat: -26.0940, lng: 27.9997 },
        'Northcliff':       { lat: -26.1484, lng: 27.9502 },
        'Linden':           { lat: -26.1412, lng: 28.0039 },
        'Greenside':        { lat: -26.1570, lng: 28.0126 },
        'Parkhurst':        { lat: -26.1597, lng: 28.0176 },
        'Rosebank':         { lat: -26.1456, lng: 28.0431 },
        'Melrose':          { lat: -26.1435, lng: 28.0657 },
        'Illovo':           { lat: -26.1279, lng: 28.0614 },
        'Hyde Park':        { lat: -26.1198, lng: 28.0398 },
        'Craighall':        { lat: -26.1122, lng: 28.0153 },
        'Morningside':      { lat: -26.1048, lng: 28.0709 },
        'Sunninghill':      { lat: -26.0421, lng: 28.0680 },
        'Woodmead':         { lat: -26.0564, lng: 28.0944 },
        'Paulshof':         { lat: -26.0406, lng: 28.0895 },
        'Douglasdale':      { lat: -26.0250, lng: 28.0134 },
        'Dainfern':         { lat: -25.9956, lng: 28.0200 },
        'Cosmo City':       { lat: -26.0213, lng: 27.9264 },
        'Honeydew':         { lat: -26.0660, lng: 27.9437 },
      },
    },

    jhb_cbd: {
      name: 'JHB CBD & Inner City',
      center: { lat: -26.2041, lng: 28.0473 },
      radiusKm: 12,
      suburbs: {
        'Johannesburg':       { lat: -26.2041, lng: 28.0473 },
        'Johannesburg Cbd':   { lat: -26.2041, lng: 28.0473 },
        'Joburg Cbd':         { lat: -26.2041, lng: 28.0473 },
        'Braamfontein':       { lat: -26.1936, lng: 28.0387 },
        'Newtown':            { lat: -26.2028, lng: 28.0397 },
        'Marshalltown':       { lat: -26.2077, lng: 28.0527 },
        'Fordsburg':          { lat: -26.2122, lng: 28.0323 },
        'Mayfair':            { lat: -26.2219, lng: 28.0278 },
        'Crown Mines':        { lat: -26.2250, lng: 28.0127 },
        'Hillbrow':           { lat: -26.1876, lng: 28.0530 },
        'Yeoville':           { lat: -26.1869, lng: 28.0742 },
        'Berea':              { lat: -26.1961, lng: 28.0643 },
        'Doornfontein':       { lat: -26.2025, lng: 28.0673 },
        'Jeppestown':         { lat: -26.2039, lng: 28.0728 },
        'Observatory':        { lat: -26.1764, lng: 28.0767 },
        'Parktown':           { lat: -26.1874, lng: 28.0416 },
        'Westdene':           { lat: -26.1768, lng: 27.9990 },
        'Auckland Park':      { lat: -26.1838, lng: 28.0041 },
        'Melville':           { lat: -26.1901, lng: 27.9964 },
        'Sophiatown':         { lat: -26.1879, lng: 27.9990 },
        'Westbury':           { lat: -26.2047, lng: 27.9877 },
        'Newlands':           { lat: -26.2143, lng: 28.0003 },
        'Crosby':             { lat: -26.2239, lng: 27.9776 },
        'Vrededorp':          { lat: -26.2015, lng: 28.0176 },
        'Richmond':           { lat: -26.2263, lng: 28.0031 },
      },
    },

    jhb_south: {
      name: 'JHB South / Soweto',
      center: { lat: -26.2674, lng: 27.8794 },
      radiusKm: 22,
      suburbs: {
        'Soweto':               { lat: -26.2674, lng: 27.8588 },
        'Lenasia':              { lat: -26.3197, lng: 27.8299 },
        'Lenasia South':        { lat: -26.3373, lng: 27.8201 },
        'Johannesburg South':   { lat: -26.2674, lng: 27.8588 },
        'Joburg South':         { lat: -26.2674, lng: 27.8588 },
        'Turffontein':          { lat: -26.2515, lng: 28.0426 },
        'Bassonia':             { lat: -26.2974, lng: 28.0501 },
        'Crown Gardens':        { lat: -26.2683, lng: 28.0143 },
        'Liefde En Vrede':      { lat: -26.2889, lng: 28.0344 },
        'Rosettenville':        { lat: -26.2592, lng: 28.0568 },
        'Glenanda':             { lat: -26.2940, lng: 28.0417 },
        'Ormonde':              { lat: -26.2482, lng: 27.9924 },
        'Eldorado Park':        { lat: -26.2968, lng: 27.9167 },
        'Ennerdale':            { lat: -26.3466, lng: 27.8830 },
        'Naturena':             { lat: -26.3153, lng: 27.9479 },
        'Kibler Park':          { lat: -26.3233, lng: 28.0168 },
        'Mulbarton':            { lat: -26.3197, lng: 28.0420 },
        'Glenvista':            { lat: -26.3156, lng: 28.0636 },
        'Alberton':             { lat: -26.2659, lng: 28.1222 },
        'Brackenhurst':         { lat: -26.3023, lng: 28.1244 },
        'Meyersdal':            { lat: -26.3166, lng: 28.1019 },
      },
    },

    jhb_east: {
      name: 'JHB East',
      center: { lat: -26.1631, lng: 28.1550 },
      radiusKm: 18,
      suburbs: {
        'Edenvale':       { lat: -26.1310, lng: 28.1619 },
        'Bedfordview':    { lat: -26.1848, lng: 28.1442 },
        'Germiston':      { lat: -26.2141, lng: 28.1654 },
        'Eastgate':       { lat: -26.1639, lng: 28.1253 },
        'Sandringham':    { lat: -26.1635, lng: 28.0960 },
        'Kensington':     { lat: -26.1894, lng: 28.0961 },
        'Bezuidenhout Valley': { lat: -26.1988, lng: 28.0842 },
        'Highlands North': { lat: -26.1746, lng: 28.0905 },
        'Orange Grove':   { lat: -26.1735, lng: 28.0769 },
        'Houghton':       { lat: -26.1638, lng: 28.0719 },
        'Saxonwold':      { lat: -26.1584, lng: 28.0583 },
        'Linksfield':     { lat: -26.1530, lng: 28.1119 },
        'Bramley':        { lat: -26.1330, lng: 28.0861 },
        'Dowerglen':      { lat: -26.1379, lng: 28.1357 },
        'Modderfontein':  { lat: -26.1072, lng: 28.1698 },
        'Isando':         { lat: -26.1430, lng: 28.1967 },
        'Elandsfontein':  { lat: -26.1725, lng: 28.2054 },
      },
    },

    jhb_west: {
      name: 'JHB West / Roodepoort',
      center: { lat: -26.1568, lng: 27.8900 },
      radiusKm: 20,
      suburbs: {
        'Roodepoort':     { lat: -26.1644, lng: 27.8730 },
        'Florida':        { lat: -26.1681, lng: 27.9174 },
        'Weltevreden Park': { lat: -26.1157, lng: 27.9279 },
        'Strubensvalley': { lat: -26.1013, lng: 27.8884 },
        'Johannesburg West': { lat: -26.1644, lng: 27.8730 },
        'Joburg West':    { lat: -26.1644, lng: 27.8730 },
        'Discovery':      { lat: -26.1389, lng: 27.8743 },
        'Ruimsig':        { lat: -26.1007, lng: 27.8671 },
        'Little Falls':   { lat: -26.0826, lng: 27.9282 },
        'Radiokop':       { lat: -26.0929, lng: 27.9155 },
        'Bromhof':        { lat: -26.0725, lng: 27.9604 },
        'Randpark Ridge': { lat: -26.0878, lng: 27.9782 },
        'Wilgeheuwel':    { lat: -26.0723, lng: 27.9063 },
      },
    },

    east_rand: {
      name: 'East Rand / Ekurhuleni',
      center: { lat: -26.1316, lng: 28.2706 },
      radiusKm: 22,
      suburbs: {
        'Kempton Park':   { lat: -26.0991, lng: 28.2281 },
        'Tembisa':        { lat: -26.0018, lng: 28.2207 },
        'Boksburg':       { lat: -26.2088, lng: 28.2556 },
        'Benoni':         { lat: -26.1851, lng: 28.3175 },
        'Brakpan':        { lat: -26.2351, lng: 28.3703 },
        'Springs':        { lat: -26.2496, lng: 28.4417 },
        'Daveyton':       { lat: -26.1467, lng: 28.3920 },
        'Katlehong':      { lat: -26.3249, lng: 28.1710 },
        'Thokoza':        { lat: -26.3491, lng: 28.1847 },
        'Vosloorus':      { lat: -26.3444, lng: 28.2213 },
        'Etwatwa':        { lat: -26.1665, lng: 28.4256 },
        'Dunnottar':      { lat: -26.3296, lng: 28.5028 },
        'Nigel':          { lat: -26.4154, lng: 28.4840 },
        'Heidelberg':     { lat: -26.5048, lng: 28.3610 },
        'Ekurhuleni':     { lat: -26.1316, lng: 28.2706 },
      },
    },

    centurion_midrand: {
      name: 'Centurion / Midrand',
      center: { lat: -25.9006, lng: 28.1560 },
      radiusKm: 25,
      suburbs: {
        'Midrand':        { lat: -25.9006, lng: 28.1277 },
        'Centurion':      { lat: -25.8603, lng: 28.1888 },
        'Halfway House':  { lat: -25.9759, lng: 28.1268 },
        'Irene':          { lat: -25.8940, lng: 28.2239 },
        'Waterfall':      { lat: -25.9500, lng: 28.1200 },
        'Kyalami':        { lat: -25.9774, lng: 28.0638 },
        'Glen Austin':    { lat: -25.9474, lng: 28.1697 },
        'Noordwyk':       { lat: -25.9201, lng: 28.1371 },
        'Bredell':        { lat: -26.0119, lng: 28.1820 },
        'Lonehill':       { lat: -26.0095, lng: 28.0328 },
        'Blue Hills':     { lat: -25.9337, lng: 28.1581 },
        'Tembisa South':  { lat: -26.0360, lng: 28.1756 },
      },
    },

    pretoria_east: {
      name: 'Pretoria East',
      center: { lat: -25.7900, lng: 28.3000 },
      radiusKm: 20,
      suburbs: {
        'Menlyn':         { lat: -25.7900, lng: 28.2766 },
        'Lynnwood':       { lat: -25.7753, lng: 28.3020 },
        'Garsfontein':    { lat: -25.8127, lng: 28.3240 },
        'Faerie Glen':    { lat: -25.7812, lng: 28.3140 },
        'Waterkloof':     { lat: -25.7938, lng: 28.2597 },
        'Waterkloof Ridge': { lat: -25.7963, lng: 28.2718 },
        'Moreleta Park':  { lat: -25.8235, lng: 28.3127 },
        'Equestria':      { lat: -25.8054, lng: 28.3264 },
        'Silver Lakes':   { lat: -25.8024, lng: 28.3724 },
        'Willow Acres':   { lat: -25.7820, lng: 28.3892 },
        'Woodhill':       { lat: -25.8235, lng: 28.3531 },
        'Olympus':        { lat: -25.7734, lng: 28.3382 },
        'Pretoria East':  { lat: -25.7900, lng: 28.3000 },
      },
    },

    pretoria_cbd: {
      name: 'Pretoria CBD & Central',
      center: { lat: -25.7462, lng: 28.1882 },
      radiusKm: 15,
      suburbs: {
        'Arcadia':        { lat: -25.7462, lng: 28.1882 },
        'Hatfield':       { lat: -25.7465, lng: 28.2208 },
        'Sunnyside':      { lat: -25.7604, lng: 28.2123 },
        'Brooklyn':       { lat: -25.7620, lng: 28.2280 },
        'Pretoria':       { lat: -25.7479, lng: 28.1878 },
        'Pretoria Cbd':   { lat: -25.7479, lng: 28.1878 },
        'New Muckleneuk': { lat: -25.7802, lng: 28.2168 },
        'Muckleneuk':     { lat: -25.7736, lng: 28.2038 },
        'Groenkloof':     { lat: -25.7893, lng: 28.1918 },
        'Colbyn':         { lat: -25.7295, lng: 28.2221 },
        'Clydesdale':     { lat: -25.7507, lng: 28.2036 },
        'Ashlea Gardens': { lat: -25.7698, lng: 28.2427 },
        'Erasmuskloof':   { lat: -25.8001, lng: 28.2379 },
        'Elardus Park':   { lat: -25.8230, lng: 28.2638 },
      },
    },

    pretoria_north: {
      name: 'Pretoria North',
      center: { lat: -25.6714, lng: 28.1700 },
      radiusKm: 20,
      suburbs: {
        'Wonderboom':     { lat: -25.6714, lng: 28.1847 },
        'Akasia':         { lat: -25.6595, lng: 28.1508 },
        'Pretoria North': { lat: -25.6832, lng: 28.1744 },
        'Rosslyn':        { lat: -25.6539, lng: 28.1056 },
        'Ga-rankuwa':     { lat: -25.6264, lng: 28.0040 },
        'Mabopane':       { lat: -25.5822, lng: 28.0544 },
        'Soshanguve':     { lat: -25.5267, lng: 28.0980 },
        'Doornpoort':     { lat: -25.6601, lng: 28.2073 },
        'Eersterust':     { lat: -25.6954, lng: 28.3001 },
        'Mamelodi':       { lat: -25.7237, lng: 28.3604 },
        'Nellmapius':     { lat: -25.7393, lng: 28.3460 },
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
        'Bellville':    { lat: -33.9167, lng: 18.6333 },
        'Parow':        { lat: -33.9053, lng: 18.5980 },
        'Goodwood':     { lat: -33.9202, lng: 18.5527 },
        'Tygervalley':  { lat: -33.8650, lng: 18.6300 },
        'Durbanville':  { lat: -33.8319, lng: 18.6476 },
        'Brackenfell':  { lat: -33.8749, lng: 18.6861 },
        'Kuils River':  { lat: -33.9265, lng: 18.6965 },
      },
    },
    cape_town_south: {
      name: 'Cape Town Southern Suburbs',
      center: { lat: -33.9698, lng: 18.4637 },
      radiusKm: 15,
      suburbs: {
        'Claremont':    { lat: -33.9860, lng: 18.4700 },
        'Rondebosch':   { lat: -33.9680, lng: 18.4756 },
        'Kenilworth':   { lat: -33.9994, lng: 18.4775 },
        'Wynberg':      { lat: -34.0105, lng: 18.4756 },
        'Plumstead':    { lat: -34.0162, lng: 18.4726 },
        'Diep River':   { lat: -34.0337, lng: 18.4728 },
        'Tokai':        { lat: -34.0564, lng: 18.4532 },
      },
    },
    cape_town_cbd: {
      name: 'Cape Town CBD & Atlantic Seaboard',
      center: { lat: -33.9249, lng: 18.4241 },
      radiusKm: 12,
      suburbs: {
        'Cape Town':          { lat: -33.9249, lng: 18.4241 },
        'Cape Town Cbd':      { lat: -33.9249, lng: 18.4241 },
        'Gardens':            { lat: -33.9360, lng: 18.4185 },
        'De Waterkant':       { lat: -33.9227, lng: 18.4202 },
        'Sea Point':          { lat: -33.9182, lng: 18.3960 },
        'Green Point':        { lat: -33.9127, lng: 18.4109 },
        'Mouille Point':      { lat: -33.9049, lng: 18.4063 },
        'Fresnaye':           { lat: -33.9202, lng: 18.3896 },
        'Three Anchor Bay':   { lat: -33.9101, lng: 18.4000 },
        'Woodstock':          { lat: -33.9282, lng: 18.4502 },
        'Observatory':        { lat: -33.9411, lng: 18.4711 },
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
        'Umhlanga':       { lat: -29.7245, lng: 31.0859 },
        'La Lucia':       { lat: -29.7607, lng: 31.0557 },
        'Durban North':   { lat: -29.7889, lng: 31.0425 },
        'Ballito':        { lat: -29.5350, lng: 31.2060 },
        'Umdloti':        { lat: -29.6770, lng: 31.1140 },
      },
    },
    durban_cbd: {
      name: 'Durban CBD & Berea',
      center: { lat: -29.8587, lng: 31.0218 },
      radiusKm: 15,
      suburbs: {
        'Durban':         { lat: -29.8587, lng: 31.0218 },
        'Durban Cbd':     { lat: -29.8587, lng: 31.0218 },
        'Morningside':    { lat: -29.8375, lng: 31.0100 },
        'Berea':          { lat: -29.8517, lng: 30.9967 },
        'Musgrave':       { lat: -29.8565, lng: 30.9985 },
        'Glenwood':       { lat: -29.8762, lng: 30.9935 },
        'Overport':       { lat: -29.8463, lng: 30.9805 },
        'Westville':      { lat: -29.8438, lng: 30.9369 },
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
