import { describe, expect, it } from 'vitest'

import type { DriveMetric, DriveReport } from '../api/hooks'
import { CARRIER_PALETTE, OTHER_CARRIER_COLOR } from '../map/carriers'
import { cellColors, formatDistance, formatDuration, quality, qualityRanges } from './drive'

const rsrp: DriveMetric = { code: 'rsrp', title: 'RSRP', unit: 'дБм', bounds: [-90, -100, -110] }

describe('quality', () => {
  it('puts values into four classes by the lower bounds', () => {
    expect(quality(rsrp, -80)).toBe('good')
    expect(quality(rsrp, -90)).toBe('good')
    expect(quality(rsrp, -95)).toBe('fair')
    expect(quality(rsrp, -105)).toBe('poor')
    expect(quality(rsrp, -111)).toBe('bad')
    expect(quality(rsrp, null)).toBeNull()
  })
  it('describes the ranges for the legend', () => {
    expect(qualityRanges(rsrp)).toEqual({
      good: '≥ -90 дБм',
      fair: '-100…-90 дБм',
      poor: '-110…-100 дБм',
      bad: '< -110 дБм',
    })
  })
})

describe('cellColors', () => {
  const cell = (eci: number, name: string | null) => ({
    eci,
    enb_id: 534344,
    local_cell_id: eci % 256,
    pci: 1,
    cell_id: name ? eci : null,
    cell_name: name,
    site_id: null,
    site_code: null,
    samples: 10,
    rsrp_median: null,
    rsrq_median: null,
    sinr_median: null,
    max_distance_m: null,
    inventory_pci: null,
  })
  it('gives the seven busiest cells fixed slots and folds the rest into gray', () => {
    const cells = Array.from({ length: 9 }, (_, i) => cell(i, i === 8 ? null : `C${i}`))
    const { byEci, legend } = cellColors({ cells } as unknown as DriveReport)
    expect(byEci.get(0)).toBe(CARRIER_PALETTE[0])
    expect(byEci.get(6)).toBe(CARRIER_PALETTE[6])
    expect(byEci.get(7)).toBe(OTHER_CARRIER_COLOR)
    expect(legend.map((c) => c.label).at(-1)).toBe('другие (2)')
    expect(legend).toHaveLength(8)
  })
})

describe('formatting', () => {
  it('formats durations and distances', () => {
    expect(formatDuration(51 * 60_000 + 18_000)).toBe('51 мин')
    expect(formatDuration(135 * 60_000)).toBe('2 ч 15 мин')
    expect(formatDistance(640)).toBe('640 м')
    expect(formatDistance(26_016)).toBe('26 км')
  })
})
