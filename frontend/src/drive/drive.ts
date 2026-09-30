import type { DriveMetric, DriveReport } from '../api/hooks'
import { CARRIER_PALETTE, OTHER_CARRIER_COLOR } from '../map/carriers'

export type Quality = 'good' | 'fair' | 'poor' | 'bad'
export const QUALITIES: Quality[] = ['good', 'fair', 'poor', 'bad']

/** Status palette (good / warning / serious / critical): reserved for signal quality. */
export const QUALITY_COLORS: Record<Quality | 'none', string> = {
  good: '#0ca30c',
  fair: '#fab219',
  poor: '#ec835a',
  bad: '#d03b3b',
  none: '#898781',
}

export const QUALITY_LABELS: Record<Quality | 'none', string> = {
  good: 'хорошо',
  fair: 'удовлетворительно',
  poor: 'плохо',
  bad: 'очень плохо',
  none: 'нет измерения',
}

export type ColorBy = 'rsrp' | 'rsrq' | 'sinr' | 'cell'

export function quality(metric: DriveMetric, value: number | null | undefined): Quality | null {
  if (value === null || value === undefined) return null
  const [good, fair, poor] = metric.bounds
  if (value >= good) return 'good'
  if (value >= fair) return 'fair'
  if (value >= poor) return 'poor'
  return 'bad'
}

const number = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 })
export const formatNumber = (v: number | null | undefined) => (v == null ? '—' : number.format(v))

/** "≥ −90 дБм", "−100…−90 дБм", ... for the legend. */
export function qualityRanges(metric: DriveMetric): Record<Quality, string> {
  const [good, fair, poor] = metric.bounds.map((v) => number.format(v))
  const unit = ` ${metric.unit}`
  return {
    good: `≥ ${good}${unit}`,
    fair: `${fair}…${good}${unit}`,
    poor: `${poor}…${fair}${unit}`,
    bad: `< ${poor}${unit}`,
  }
}

export type CellColor = { eci: number; label: string; color: string }

/** Serving cell colors: the seven busiest cells get palette slots in a fixed order, the rest
 * share one gray. The eighth slot is kept for "other" so no hue repeats. */
export function cellColors(report: DriveReport): {
  byEci: Map<number, string>
  legend: CellColor[]
} {
  const byEci = new Map<number, string>()
  const legend: CellColor[] = []
  report.cells.forEach((cell, i) => {
    const color = i < 7 ? (CARRIER_PALETTE[i] ?? OTHER_CARRIER_COLOR) : OTHER_CARRIER_COLOR
    byEci.set(cell.eci, color)
    if (i < 7) legend.push({ eci: cell.eci, label: cellLabel(cell), color })
  })
  if (report.cells.length > 7) {
    legend.push({
      eci: -1,
      label: `другие (${report.cells.length - 7})`,
      color: OTHER_CARRIER_COLOR,
    })
  }
  return { byEci, legend }
}

export function cellLabel(cell: DriveReport['cells'][number]): string {
  return (
    cell.cell_name ?? `eNB ${cell.enb_id ?? '?'} / ${cell.local_cell_id ?? '?'} (нет в инвентаре)`
  )
}

export function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000)
  if (minutes < 60) return `${minutes} мин`
  return `${Math.floor(minutes / 60)} ч ${minutes % 60} мин`
}

export function formatDistance(meters: number): string {
  return meters < 1000 ? `${Math.round(meters)} м` : `${number.format(meters / 1000)} км`
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return '—'
  if (bytes < 1024 * 1024) return `${number.format(bytes / 1024)} КБ`
  return `${number.format(bytes / 1024 / 1024)} МБ`
}

export const PROBLEM_LABELS: Record<string, string> = {
  weak_coverage: 'Слабое покрытие',
  interference: 'Помехи',
  gap: 'Нет измерений',
}
