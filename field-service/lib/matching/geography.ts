import { MATCHING_CONFIG } from './config'

type Point = { lat: number | null; lng: number | null }

export function haversineKm(a: Point, b: Point) {
  if (a.lat == null || a.lng == null || b.lat == null || b.lng == null) {
    return null
  }

  const toRad = (degrees: number) => (degrees * Math.PI) / 180
  const earthRadiusKm = 6371
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const sa =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(sa), Math.sqrt(1 - sa))

  return earthRadiusKm * c
}

export function isLocationStale(lastKnownLocationAt: Date | null | undefined) {
  if (!lastKnownLocationAt) return true

  return (
    Date.now() - lastKnownLocationAt.getTime() >
    MATCHING_CONFIG.staleLocationThresholdHours * 60 * 60 * 1000
  )
}

export function pointFallsWithinRadius(params: {
  center: Point
  point: Point
  radiusKm: number | null | undefined
}) {
  if (
    params.center.lat == null ||
    params.center.lng == null ||
    params.point.lat == null ||
    params.point.lng == null ||
    params.radiusKm == null
  ) {
    return false
  }

  const distanceKm = haversineKm(params.center, params.point)
  if (distanceKm == null) return false

  return distanceKm <= params.radiusKm
}

export function estimateTravelMinutes(params: {
  from: Point
  to: Point
  fromArea?: { suburb?: string | null; city?: string | null }
  toArea?: { suburb?: string | null; city?: string | null }
}) {
  const { from, to, fromArea, toArea } = params
  const distanceKm = haversineKm(from, to)

  if (distanceKm != null) {
    const minutes =
      (distanceKm / MATCHING_CONFIG.travel.defaultSpeedKmh) * 60
    return Math.max(MATCHING_CONFIG.travel.minTravelMinutes, Math.round(minutes))
  }

  const fromSuburb = fromArea?.suburb?.trim().toLowerCase()
  const toSuburb = toArea?.suburb?.trim().toLowerCase()
  if (fromSuburb && toSuburb && fromSuburb === toSuburb) {
    return MATCHING_CONFIG.travel.sameSuburbMinutes
  }

  const fromCity = fromArea?.city?.trim().toLowerCase()
  const toCity = toArea?.city?.trim().toLowerCase()
  if (fromCity && toCity && fromCity === toCity) {
    return MATCHING_CONFIG.travel.sameCityMinutes
  }

  if (!fromCity || !toCity) {
    return MATCHING_CONFIG.travel.unknownLocationMinutes
  }

  return MATCHING_CONFIG.travel.crossCityMinutes
}
