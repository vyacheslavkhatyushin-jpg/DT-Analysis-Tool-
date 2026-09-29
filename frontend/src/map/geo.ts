const EARTH_RADIUS_M = 6_371_008.8
const toRad = (deg: number) => (deg * Math.PI) / 180
const toDeg = (rad: number) => (rad * 180) / Math.PI

export type LonLat = [number, number]

/** Point reached from `start` travelling `distanceM` metres along `bearingDeg` (great circle). */
export function destination([lon, lat]: LonLat, bearingDeg: number, distanceM: number): LonLat {
  const delta = distanceM / EARTH_RADIUS_M
  const theta = toRad(bearingDeg)
  const phi1 = toRad(lat)
  const lambda1 = toRad(lon)
  const phi2 = Math.asin(
    Math.sin(phi1) * Math.cos(delta) + Math.cos(phi1) * Math.sin(delta) * Math.cos(theta),
  )
  const lambda2 =
    lambda1 +
    Math.atan2(
      Math.sin(theta) * Math.sin(delta) * Math.cos(phi1),
      Math.cos(delta) - Math.sin(phi1) * Math.sin(phi2),
    )
  return [((toDeg(lambda2) + 540) % 360) - 180, toDeg(phi2)]
}

/** Closed polygon ring of an antenna sector: apex at the site, arc of `beamwidthDeg`. */
export function sectorRing(
  site: LonLat,
  azimuthDeg: number,
  beamwidthDeg: number,
  radiusM: number,
  arcSteps = 16,
): LonLat[] {
  const width = Math.min(Math.max(beamwidthDeg, 1), 359)
  const start = azimuthDeg - width / 2
  const ring: LonLat[] = [site]
  for (let i = 0; i <= arcSteps; i++) {
    ring.push(destination(site, start + (width * i) / arcSteps, radiusM))
  }
  ring.push(site)
  return ring
}

/** Closed ring approximating a circle, used for omni cells (no azimuth). */
export function circleRing(center: LonLat, radiusM: number, steps = 32): LonLat[] {
  const ring: LonLat[] = []
  for (let i = 0; i <= steps; i++) ring.push(destination(center, (360 * i) / steps, radiusM))
  return ring
}

export type Bounds = [number, number, number, number]

export function boundsOf(points: LonLat[]): Bounds | null {
  if (points.length === 0) return null
  let [west, south] = points[0]!
  let [east, north] = points[0]!
  for (const [lon, lat] of points) {
    west = Math.min(west, lon)
    east = Math.max(east, lon)
    south = Math.min(south, lat)
    north = Math.max(north, lat)
  }
  return [west, south, east, north]
}
