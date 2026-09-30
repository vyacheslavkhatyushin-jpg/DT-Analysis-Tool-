import { Box, Paper, Text } from '@mantine/core'
import { useElementSize } from '@mantine/hooks'
import { type KeyboardEvent, type PointerEvent, useMemo, useState } from 'react'

export type TimePoint = { time: number; value: number | null }
export type Threshold = { value: number; color: string; label: string }

const SERIES = '#2a78d6' // categorical slot 1: a single series
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const MARGIN = { top: 12, right: 64, bottom: 22, left: 44 }

const dayTick = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit' })
const timeTick = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' })
const TOOLTIP_FORMATS = {
  day: new Intl.DateTimeFormat('ru-RU', { weekday: 'short', day: '2-digit', month: '2-digit' }),
  hour: new Intl.DateTimeFormat('ru-RU', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }),
  second: new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }),
}
const number = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 })
const NO_THRESHOLDS: Threshold[] = []
const defaultFormat = (v: number) => number.format(v)

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

/** Time ticks at round moments: minutes for a drive, hours for a day, days for longer. */
function timeTicks(t0: number, t1: number, plotW: number): { ticks: number[]; days: boolean } {
  const span = t1 - t0
  const wanted = Math.max(2, Math.floor(plotW / 70))
  if (span > 1.5 * DAY) {
    const every = Math.max(1, Math.ceil(span / DAY / wanted))
    const first = new Date(t0)
    first.setHours(24, 0, 0, 0)
    const ticks = []
    for (let t = first.getTime(); t <= t1; t += every * DAY) ticks.push(t)
    return { ticks, days: true }
  }
  const steps = [1, 2, 5, 10, 15, 30, 60, 120, 180, 360, 720].map((m) => m * MINUTE)
  const step = steps.find((s) => span / s <= wanted) ?? 12 * HOUR
  // Round to the step in local time: 09:45, not 09:43.
  const offset = new Date(t0).getTimezoneOffset() * MINUTE
  const ticks = []
  for (let t = Math.ceil((t0 - offset) / step) * step + offset; t <= t1; t += step) ticks.push(t)
  return { ticks, days: false }
}

type Props = {
  points: TimePoint[]
  /** What is plotted, for screen readers: "RSRP, дБм". */
  label: string
  unit?: string
  thresholds?: Threshold[]
  /** Points farther apart than this are not joined: a gap in the data. */
  gapMs: number
  tooltipTime: keyof typeof TOOLTIP_FORMATS
  format?: (value: number) => string
  /** Percentages: the axis stays within 0–100. */
  percent?: boolean
  height?: number
  /** Controlled cursor (index into points), e.g. synchronised with a map. */
  cursor?: number | null
  onCursor?: (index: number | null) => void
  onPick?: (index: number) => void
}

/** Line over time with threshold lines; crosshair tooltip on hover and keyboard. */
export function TimeChart({
  points,
  label,
  unit,
  thresholds = NO_THRESHOLDS,
  gapMs,
  tooltipTime,
  format = defaultFormat,
  percent = false,
  height = 200,
  cursor: controlled,
  onCursor,
  onPick,
}: Props) {
  const { ref, width } = useElementSize()
  const [own, setOwn] = useState<number | null>(null)
  const cursor = controlled !== undefined ? controlled : own
  const setCursor = (index: number | null) => {
    setOwn(index)
    onCursor?.(index)
  }

  const layout = useMemo(() => {
    const values = points.flatMap((p) => (p.value === null ? [] : [p.value]))
    if (values.length === 0 || width === 0) return null
    const levels = thresholds.map((t) => t.value)
    let [lo, hi] = [Math.min(...values, ...levels), Math.max(...values, ...levels)]
    if (percent) [lo, hi] = [Math.max(0, lo), Math.min(100, hi)]
    if (lo === hi) [lo, hi] = [lo - 1, hi + 1]
    const pad = (hi - lo) * 0.06
    const [y0, y1] = [lo - pad, hi + pad]
    const t0 = points[0]?.time ?? 0
    const t1 = points.at(-1)?.time ?? t0
    const plotW = width - MARGIN.left - MARGIN.right
    const plotH = height - MARGIN.top - MARGIN.bottom
    const x = (t: number) => MARGIN.left + (t1 === t0 ? plotW / 2 : ((t - t0) / (t1 - t0)) * plotW)
    const y = (v: number) => MARGIN.top + (1 - (v - y0) / (y1 - y0)) * plotH
    let path = ''
    let previous: TimePoint | null = null
    for (const p of points) {
      if (p.value === null) {
        previous = null
        continue
      }
      const joined = previous !== null && p.time - previous.time <= gapMs
      path += `${joined ? 'L' : 'M'}${x(p.time).toFixed(1)},${y(p.value).toFixed(1)}`
      previous = p
    }
    const top = Math.max(...levels)
    return {
      x,
      y,
      path,
      plotW,
      plotH,
      t0,
      t1,
      top,
      yTicks: niceTicks(y0, y1),
      ...timeTicks(t0, t1, plotW),
    }
  }, [points, thresholds, width, height, gapMs, percent])

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
  const onClick = (e: PointerEvent<SVGSVGElement>) => {
    const index = nearest(e.clientX, e.currentTarget.getBoundingClientRect())
    if (index !== null) onPick?.(index)
  }
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key === 'Enter' && cursor !== null) onPick?.(cursor)
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const step = e.key === 'ArrowLeft' ? -1 : 1
    setCursor(Math.min(points.length - 1, Math.max(0, (cursor ?? points.length - 1) + step)))
  }

  const active = cursor !== null ? points[cursor] : undefined
  const withUnit = (v: number | null) =>
    v === null ? '—' : unit ? `${format(v)} ${unit}` : format(v)

  return (
    <Box ref={ref} pos="relative" h={height}>
      {layout === null ? (
        <Text size="sm" c="dimmed" pt="md">
          Нет значений
        </Text>
      ) : (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`${label}. Стрелки влево и вправо — перемещение по времени`}
          tabIndex={0}
          onPointerMove={onMove}
          onPointerLeave={() => setCursor(null)}
          onPointerUp={onClick}
          onKeyDown={onKey}
          onBlur={() => setCursor(null)}
          style={{
            display: 'block',
            outline: 'none',
            touchAction: 'pan-y',
            cursor: onPick ? 'pointer' : undefined,
          }}
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
                {format(v)}
              </text>
            </g>
          ))}
          {layout.ticks.map((t) => (
            <text
              key={t}
              x={layout.x(t)}
              y={height - 6}
              textAnchor="middle"
              fontSize={11}
              fill="var(--mantine-color-dimmed)"
            >
              {(layout.days ? dayTick : timeTick).format(t)}
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
                // The top line's label sits above it, the others below: close lines don't overlap.
                dy={t.value === layout.top ? '-0.25em' : '0.9em'}
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
            {withUnit(active.value)}
          </Text>
          <Text size="xs" c="dimmed">
            {TOOLTIP_FORMATS[tooltipTime].format(active.time)}
          </Text>
        </Paper>
      )}
    </Box>
  )
}
