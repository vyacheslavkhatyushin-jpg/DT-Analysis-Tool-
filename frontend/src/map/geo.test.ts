import { describe, expect, it } from 'vitest'

import { boundsOf, destination, sectorRing } from './geo'

const SITE: [number, number] = [87.25, 54.05]

describe('destination', () => {
  it('moves north by the right latitude delta', () => {
    const [lon, lat] = destination(SITE, 0, 1000)
    expect(lon).toBeCloseTo(87.25, 9)
    expect(lat - 54.05).toBeCloseTo(1000 / 111_195, 5)
  })

  it('moves east along the parallel', () => {
    const [lon, lat] = destination(SITE, 90, 1000)
    expect(lat).toBeCloseTo(54.05, 4)
    expect(lon).toBeGreaterThan(87.25)
  })
})

describe('sectorRing', () => {
  it('is closed and starts at the site', () => {
    const ring = sectorRing(SITE, 120, 65, 200, 8)
    expect(ring[0]).toEqual(SITE)
    expect(ring.at(-1)).toEqual(SITE)
    expect(ring).toHaveLength(8 + 3)
  })

  it('points along the azimuth', () => {
    const ring = sectorRing(SITE, 90, 10, 500, 2)
    const middle = ring[2]!
    expect(middle[0]).toBeGreaterThan(SITE[0])
    expect(middle[1]).toBeCloseTo(SITE[1], 4)
  })
})

describe('boundsOf', () => {
  it('handles empty input', () => {
    expect(boundsOf([])).toBeNull()
  })

  it('computes the envelope', () => {
    expect(
      boundsOf([
        [1, 2],
        [3, -1],
        [0, 5],
      ]),
    ).toEqual([0, -1, 3, 5])
  })
})
