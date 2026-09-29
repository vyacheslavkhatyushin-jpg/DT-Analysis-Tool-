import { describe, expect, it } from 'vitest'

import type { KpiCellStats, KpiDef } from '../api/hooks'
import {
  aggregateDaily,
  formatKpi,
  type HourlyPoint,
  levelRanges,
  presetPeriod,
  statOf,
  statsByCell,
} from './kpi'

const hoSr: KpiDef = {
  code: 'ho_sr',
  title: 'Mobility SR',
  unit: '%',
  aggregate: 'traffic',
  better: 'high',
  warn: 98,
  bad: 95,
}
const drop: KpiDef = { ...hoSr, code: 'drop', better: 'low', warn: 1, bad: 2 }

describe('formatKpi', () => {
  it('keeps two decimals for success rates near 100 %', () => {
    expect(formatKpi(99.4510266, hoSr)).toBe('99,45')
    expect(formatKpi(100, hoSr)).toBe('100')
  })
  it('rounds volumes and small values sensibly', () => {
    expect(formatKpi(5829.305)).toBe('5 829')
    expect(formatKpi(23.31)).toBe('23,3')
    expect(formatKpi(0.853)).toBe('0,85')
    expect(formatKpi(null)).toBe('—')
  })
})

describe('levelRanges', () => {
  it('describes the zones for both directions', () => {
    expect(levelRanges(hoSr)).toEqual({ ok: '≥ 98 %', warn: '95–98 %', bad: '< 95 %' })
    expect(levelRanges(drop)).toEqual({ ok: '≤ 1 %', warn: '1–2 %', bad: '> 2 %' })
    expect(levelRanges({ ...hoSr, better: null })).toBeNull()
  })
})

describe('presetPeriod', () => {
  const bounds = { data_start: '2026-08-28T19:00:00Z', data_end: '2026-09-29T12:00:00Z' }
  it('ends where the data ends', () => {
    expect(presetPeriod('1d', bounds)).toEqual({
      start: '2026-09-28T12:00:00.000Z',
      end: '2026-09-29T12:00:00.000Z',
    })
    expect(presetPeriod('all', bounds)?.start).toBe('2026-08-28T19:00:00.000Z')
    expect(presetPeriod('7d', { data_start: null, data_end: null })).toBeNull()
  })
})

describe('statsByCell', () => {
  const stat = (hours: number) => ({ value: 1, level: null, worst: 2, worst_level: null, hours })
  const cell = (id: number, cellId: number | null, hours: number): KpiCellStats => ({
    kpi_cell_id: id,
    cell_name: `C${id}`,
    enb_name: null,
    cell_id: cellId,
    values: { ho_sr: stat(hours) },
  })
  it('prefers the statistics cell with more hours and skips unlinked ones', () => {
    const map = statsByCell([cell(1, 10, 5), cell(2, 10, 50), cell(3, null, 99)], 'ho_sr')
    expect(map.get(10)?.kpi_cell_id).toBe(2)
    expect(map.size).toBe(1)
    expect(statOf(map.get(10)?.values.ho_sr, 'worst').value).toBe(2)
  })
})

describe('aggregateDaily', () => {
  const at = (day: number, hour: number) => new Date(2026, 8, day, hour).getTime()
  const points: HourlyPoint[] = [
    { time: at(1, 0), values: { ho_sr: 90, dl_volume: 1, ul_volume: 1 } },
    { time: at(1, 1), values: { ho_sr: 100, dl_volume: 3, ul_volume: 1 } },
    { time: at(2, 0), values: { dl_volume: 5, ul_volume: 0 } },
  ]
  it('weights by traffic, sums volumes and skips days without the KPI', () => {
    const ho = aggregateDaily(points, hoSr)
    expect(ho).toHaveLength(1)
    expect(ho[0]?.value).toBeCloseTo((90 * 2 + 100 * 4) / 6)
    const volume = aggregateDaily(points, { ...hoSr, code: 'dl_volume', aggregate: 'sum' })
    expect(volume.map((p) => p.value)).toEqual([4, 5])
    expect(aggregateDaily(points, { ...hoSr, aggregate: 'mean' })[0]?.value).toBe(95)
  })
})
