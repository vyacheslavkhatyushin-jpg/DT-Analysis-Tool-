import { Group, Text, Tooltip } from '@mantine/core'

import type { KpiDef, KpiLevel } from '../api/hooks'
import { formatKpi, LEVEL_COLORS, LEVEL_LABELS } from './kpi'

/** Status mark: color plus shape, so the state never relies on color alone. */
export function LevelDot({ level, size = 10 }: { level: KpiLevel | null; size?: number }) {
  const color = LEVEL_COLORS[level ?? 'none']
  const r = size / 2
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
      {level === 'bad' ? (
        // A diamond for problems, a circle otherwise.
        <polygon points={`${r},0 ${size},${r} ${r},${size} 0,${r}`} fill={color} />
      ) : (
        <circle cx={r} cy={r} r={r - (level === 'warn' ? 0.5 : 1)} fill={color} />
      )}
    </svg>
  )
}

/** A KPI value with its status: the text stays in ink, the mark beside it carries the state. */
export function KpiValue({
  value,
  level,
  def,
}: {
  value: number | null
  level: KpiLevel | null
  def?: KpiDef
}) {
  const text = formatKpi(value, def)
  if (level === null || value === null) {
    return (
      <Text
        span
        size="sm"
        c={value === null ? 'dimmed' : undefined}
        style={{ whiteSpace: 'nowrap' }}
      >
        {text}
      </Text>
    )
  }
  return (
    <Tooltip label={LEVEL_LABELS[level]} openDelay={300}>
      <Group
        gap={6}
        wrap="nowrap"
        justify="flex-end"
        aria-label={`${text}, ${LEVEL_LABELS[level]}`}
      >
        <LevelDot level={level} />
        <Text span size="sm" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {text}
        </Text>
      </Group>
    </Tooltip>
  )
}
