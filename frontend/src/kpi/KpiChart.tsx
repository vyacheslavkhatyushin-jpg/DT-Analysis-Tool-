import { Box, Paper, Text } from '@mantine/core'
import { useElementSize } from '@mantine/hooks'
import { type KeyboardEvent, type PointerEvent, useMemo, useState } from 'react'

import type { KpiDef } from '../api/hooks'
import { type ChartPoint, formatKpi, LEVEL_COLORS, withUnit } from './kpi'

const SERIES = '#2a78d6' // categorical slot 1: a single series
const HOUR = 3600_000
const MARGIN = { top: 12, right: 64, bottom: 22, left: 44 }

const dayTick = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit' })
const hourTick = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' })
const fullDay = new Intl.DateTimeFormat('ru-RU', {
  weekday: 'short',
  day: '2-digit',
  month: '2-digit',
})
const fullTime = new Intl.DateTimeFormat('ru-RU', {
  weekday: 'short',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})

function niceTicks(min: number, max: number, count = 4): number[] {
  const span = max - min || Math.abs(max) || 1
  const raw = span / count
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? raw
  const ticks = []
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) {
    ticks.push(Math.abs(v) < step * 1e-9 ? 0 : v) // no "-0"
  }
  return ticks
}

/** Hourly KPI line with the attention and problem thresholds; crosshair tooltip on hover. */
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
  const { ref, width } = useElementSize()
  const [cursor, setCursor] = useState<number | null>(null)

  const layout = useMemo(() => {
    const values = points.flatMap((p) => (p.value === null ? [] : [p.value]))
    if (values.length === 0 || width === 0) return null
    const gap = step === 'day' ? 25 * HOUR : HOUR // a day may last 25 hours with DST
    const thresholds = [def?.warn, def?.bad].filter((t): t is number => t != null)
    let [lo, hi] = [Math.min(...values, ...thresholds), Math.max(...values, ...thresholds)]
    if (def?.unit === '%') [lo, hi] = [Math.max(0, lo), Math.min(100, hi)]
    if (lo === hi) [lo, hi] = [lo - 1, hi + 1]
    const pad = (hi - lo) * 0.06
    const [y0, y1] = [lo - pad, hi + pad]
    const t0 = points[0]?.time ?? 0
    const t1 = points.at(-1)?.time ?? t0
    const plotW = width - MARGIN.left - MARGIN.right
    const plotH = height - MARGIN.top - MARGIN.bottom
    const x = (t: number) => MARGIN.left + (t1 === t0 ? plotW / 2 : ((t - t0) / (t1 - t0)) * plotW)
    const y = (v: number) => MARGIN.top + (1 - (v - y0) / (y1 - y0)) * plotH
    // A gap of more than an hour (or a missing value) breaks the line.
    let path = ''
    let previous: ChartPoint | null = null
    for (const p of points) {
      if (p.value === null) {
        previous = null
        continue
      }
      const joined = previous !== null && p.time - previous.time <= gap
      path += `${joined ? 'L' : 'M'}${x(p.time).toFixed(1)},${y(p.value).toFixed(1)}`
      previous = p
    }
    const spanDays = (t1 - t0) / (24 * HOUR)
    const xTicks: number[] = []
    if (spanDays <= 1.5) {
      for (let t = Math.ceil(t0 / (6 * HOUR)) * 6 * HOUR; t <= t1; t += 6 * HOUR) xTicks.push(t)
    } else {
      const every = Math.max(1, Math.ceil(spanDays / Math.max(2, plotW / 70)))
      const first = new Date(t0)
      first.setHours(24, 0, 0, 0)
      for (let t = first.getTime(); t <= t1; t += every * 24 * HOUR) xTicks.push(t)
    }
    return { x, y, path, plotW, plotH, t0, t1, yTicks: niceTicks(y0, y1), xTicks, spanDays }
  }, [points, def, width, height, step])

  const nearest = (clientX: number, rect: DOMRect) => {
    if (!layout) return null
    const t =
      layout.t0 + ((clientX - rect.left - MARGIN.left) / layout.plotW) * (layout.t1 - layout.t0)
    let best = 0
    let bestDistance = Infinity
    points.forEach((p, i) => {
      const distance = Math.abs(p.time - t)
      if (distance < bestDistance) [best, bestDistance] = [i, distance]
    })
    return best
  }

  const onMove = (e: PointerEvent<SVGSVGElement>) =>
    setCursor(nearest(e.clientX, e.currentTarget.getBoundingClientRect()))
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const step = e.key === 'ArrowLeft' ? -1 : 1
    setCursor((c) => Math.min(points.length - 1, Math.max(0, (c ?? points.length - 1) + step)))
  }

  const active = cursor !== null ? points[cursor] : null
  const thresholds = [
    { value: def?.warn, color: LEVEL_COLORS.warn, label: 'внимание' },
    { value: def?.bad, color: LEVEL_COLORS.bad, label: 'проблема' },
  ].filter((t): t is { value: number; color: string; label: string } => t.value != null)

  return (
    <Box ref={ref} pos="relative" h={height}>
      {layout === null ? (
        <Text size="sm" c="dimmed" pt="md">
          Нет значений за период
        </Text>
      ) : (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`${def?.title ?? 'KPI'} по часам. Стрелки влево и вправо — перемещение по часам`}
          tabIndex={0}
          onPointerMove={onMove}
          onPointerLeave={() => setCursor(null)}
          onKeyDown={onKey}
          onBlur={() => setCursor(null)}
          style={{ display: 'block', outline: 'none', touchAction: 'pan-y' }}
        >
          {layout.yTicks.map((v) => (
            <g key={v}>
              <line
                x1={MARGIN.left}
                x2={MARGIN.left + layout.plotW}
                y1={layout.y(v)}
                y2={layout.y(v)}
                stroke="var(--mantine-color-default-border)"
                strokeWidth={1}
              />
              <text
                x={MARGIN.left - 6}
                y={layout.y(v)}
                dy="0.32em"
                textAnchor="end"
                fontSize={11}
                fill="var(--mantine-color-dimmed)"
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {formatKpi(v)}
              </text>
            </g>
          ))}
          {layout.xTicks.map((t) => (
            <text
              key={t}
              x={layout.x(t)}
              y={height - 6}
              textAnchor="middle"
              fontSize={11}
              fill="var(--mantine-color-dimmed)"
            >
              {(layout.spanDays <= 1.5 ? hourTick : dayTick).format(t)}
            </text>
          ))}
          {thresholds.map((t) => (
            <g key={t.label}>
              <line
                x1={MARGIN.left}
                x2={MARGIN.left + layout.plotW}
                y1={layout.y(t.value)}
                y2={layout.y(t.value)}
                stroke={t.color}
                strokeWidth={1}
              />
              <text
                x={MARGIN.left + layout.plotW + 6}
                y={layout.y(t.value)}
                // The upper line's label sits above it, the lower one's below: close thresholds
                // (98 and 95 % on a 0–100 scale) must not overlap.
                dy={t.value === Math.max(...thresholds.map((x) => x.value)) ? '-0.25em' : '0.9em'}
                fontSize={11}
                fill="var(--mantine-color-dimmed)"
              >
                {t.label}
              </text>
            </g>
          ))}
          <path
            d={layout.path}
            fill="none"
            stroke={SERIES}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {active && (
            <g pointerEvents="none">
              <line
                x1={layout.x(active.time)}
                x2={layout.x(active.time)}
                y1={MARGIN.top}
                y2={MARGIN.top + layout.plotH}
                stroke="var(--mantine-color-dimmed)"
                strokeWidth={1}
              />
              {active.value !== null && (
                <circle
                  cx={layout.x(active.time)}
                  cy={layout.y(active.value)}
                  r={4}
                  fill={SERIES}
                  stroke="var(--mantine-color-body)"
                  strokeWidth={2}
                />
              )}
            </g>
          )}
        </svg>
      )}
      {layout && active && (
        <Paper
          withBorder
          shadow="xs"
          px={8}
          py={4}
          pos="absolute"
          top={0}
          style={{
            pointerEvents: 'none',
            left: Math.min(Math.max(layout.x(active.time) - 70, 0), width - 150),
          }}
        >
          <Text size="sm" fw={600}>
            {withUnit(formatKpi(active.value, def), def)}
          </Text>
          <Text size="xs" c="dimmed">
            {(step === 'day' ? fullDay : fullTime).format(active.time)}
          </Text>
        </Paper>
      )}
    </Box>
  )
}
