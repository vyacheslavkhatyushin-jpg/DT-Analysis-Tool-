import { useMemo } from 'react'

import type { KpiDef } from '../api/hooks'
import { TimeChart } from '../components/TimeChart'
import { type ChartPoint, formatKpi, LEVEL_COLORS } from './kpi'

const HOUR = 3600_000

/** KPI line by hour or day with the attention and problem thresholds. */
export function KpiChart({
  points,
  def,
  height = 200,
  step = 'hour',
}: {
  points: ChartPoint[]
  def?: KpiDef
  height?: number
  /** Distance between points: hourly or daily values. */
  step?: 'hour' | 'day'
}) {
  const thresholds = useMemo(
    () =>
      [
        { value: def?.warn, color: LEVEL_COLORS.warn, label: 'внимание' },
        { value: def?.bad, color: LEVEL_COLORS.bad, label: 'проблема' },
      ].filter((t): t is { value: number; color: string; label: string } => t.value != null),
    [def],
  )
  const format = useMemo(() => (v: number) => formatKpi(v, def), [def])
  return (
    <TimeChart
      points={points}
      label={`${def?.title ?? 'KPI'} ${step === 'day' ? 'по суткам' : 'по часам'}`}
      unit={def?.unit}
      thresholds={thresholds}
      // A day may last 25 hours with a daylight saving change.
      gapMs={step === 'day' ? 25 * HOUR : HOUR}
      tooltipTime={step}
      format={format}
      percent={def?.unit === '%'}
      height={height}
    />
  )
}
