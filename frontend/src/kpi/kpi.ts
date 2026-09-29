import type { KpiCellStats, KpiDef, KpiLevel, KpiPeriod, KpiStat } from '../api/hooks'

/** Status colors (validated status palette): reserved for KPI state, never for series. */
export const LEVEL_COLORS: Record<KpiLevel | 'none', string> = {
  ok: '#0ca30c',
  warn: '#fab219',
  bad: '#d03b3b',
  none: '#898781',
}

export const LEVEL_LABELS: Record<KpiLevel | 'none', string> = {
  ok: 'норма',
  warn: 'внимание',
  bad: 'проблема',
  none: 'нет данных',
}

/** KPIs shown in tables and offered for the map, in this order. */
export const KEY_KPIS = [
  'availability',
  'rrc_sr',
  'erab_sr',
  'erab_drop_wo_ue_lost',
  'ho_sr',
  'dl_user_thp',
  'ul_bler',
  'ul_prb',
  'dl_prb',
  'dl_volume',
  'ul_volume',
] as const

export type Statistic = 'value' | 'worst'

const number = (digits: number) =>
  new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits, minimumFractionDigits: 0 })

/** Enough digits to tell 99.45 % from 99.91 %, none for gigabytes of traffic. */
export function formatKpi(value: number | null | undefined, def?: KpiDef): string {
  if (value === null || value === undefined) return '—'
  const abs = Math.abs(value)
  let digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2
  if (def?.unit === '%' && abs >= 90 && abs < 100) digits = 2
  return number(digits).format(value)
}

export function withUnit(text: string, def?: KpiDef): string {
  return def?.unit && text !== '—' ? `${text} ${def.unit}` : text
}

/** "≥ 98 %", "95–98 %", "< 95 %" for the legend. */
export function levelRanges(def: KpiDef): Record<KpiLevel, string> | null {
  if (def.warn === null || def.bad === null || !def.better) return null
  const unit = def.unit ? ` ${def.unit}` : ''
  const [w, b] = [formatKpi(def.warn), formatKpi(def.bad)]
  return def.better === 'high'
    ? { ok: `≥ ${w}${unit}`, warn: `${b}–${w}${unit}`, bad: `< ${b}${unit}` }
    : { ok: `≤ ${w}${unit}`, warn: `${w}–${b}${unit}`, bad: `> ${b}${unit}` }
}

export function statOf(stat: KpiStat | undefined, statistic: Statistic) {
  if (!stat) return { value: null, level: null }
  return statistic === 'value'
    ? { value: stat.value, level: stat.level }
    : { value: stat.worst, level: stat.worst_level }
}

/** Inventory cell id → its statistics; with several statistics cells, the one with most hours. */
export function statsByCell(cells: KpiCellStats[], kpi: string): Map<number, KpiCellStats> {
  const result = new Map<number, KpiCellStats>()
  for (const cell of cells) {
    if (cell.cell_id === null) continue
    const current = result.get(cell.cell_id)
    if (!current || (cell.values[kpi]?.hours ?? 0) > (current.values[kpi]?.hours ?? 0)) {
      result.set(cell.cell_id, cell)
    }
  }
  return result
}

export type PeriodPreset = '1d' | '7d' | '30d' | 'all'

export const PERIOD_PRESETS: { value: PeriodPreset; label: string }[] = [
  { value: '1d', label: 'Сутки' },
  { value: '7d', label: '7 дней' },
  { value: '30d', label: '30 дней' },
  { value: 'all', label: 'Всё' },
]

const DAYS: Record<Exclude<PeriodPreset, 'all'>, number> = { '1d': 1, '7d': 7, '30d': 30 }

/** Periods end where the data ends, not now: reports arrive with a delay. */
export function presetPeriod(
  preset: PeriodPreset,
  bounds: { data_start: string | null; data_end: string | null } | undefined,
): KpiPeriod | null {
  if (!bounds?.data_start || !bounds.data_end) return null
  const end = new Date(bounds.data_end)
  const start =
    preset === 'all'
      ? new Date(bounds.data_start)
      : new Date(end.getTime() - DAYS[preset] * 24 * 3600_000)
  return { start: start.toISOString(), end: end.toISOString() }
}

const dayFormat = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})

export function formatPeriod(start: string | null, end: string | null): string {
  if (!start || !end) return 'нет данных'
  return `${dayFormat.format(new Date(start))} — ${dayFormat.format(new Date(end))}`
}

export type HourlyPoint = { time: number; values: Record<string, number> }
export type ChartPoint = { time: number; value: number | null }

/** Daily values the way the server aggregates a period: sum, traffic-weighted or plain mean. */
export function aggregateDaily(points: HourlyPoint[], def: KpiDef): ChartPoint[] {
  const days = new Map<number, { sum: number; weighted: number; weight: number; n: number }>()
  for (const p of points) {
    const value = p.values[def.code]
    if (value === undefined) continue
    const day = new Date(p.time)
    day.setHours(0, 0, 0, 0)
    const bucket = days.get(day.getTime()) ?? { sum: 0, weighted: 0, weight: 0, n: 0 }
    const weight = (p.values.dl_volume ?? 0) + (p.values.ul_volume ?? 0)
    bucket.sum += value
    bucket.weighted += value * weight
    bucket.weight += weight
    bucket.n += 1
    days.set(day.getTime(), bucket)
  }
  return [...days.entries()]
    .sort(([a], [b]) => a - b)
    .map(([time, b]) => ({
      time,
      value:
        def.aggregate === 'sum'
          ? b.sum
          : def.aggregate === 'traffic' && b.weight > 0
            ? b.weighted / b.weight
            : b.sum / b.n,
    }))
}
