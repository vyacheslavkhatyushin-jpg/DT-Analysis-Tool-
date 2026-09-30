import { Box, Group, Stack, Text, Tooltip } from '@mantine/core'

import type { DriveMetric, DriveReport } from '../api/hooks'
import { formatNumber, QUALITIES, QUALITY_COLORS, QUALITY_LABELS, qualityRanges } from './drive'

type Distribution = DriveReport['distributions'][number]

/** Part-to-whole of the four quality classes: a stacked bar with a labelled legend under it. */
export function QualityBar({
  metric,
  distribution,
}: {
  metric: DriveMetric
  distribution: Distribution
}) {
  const total = QUALITIES.reduce((sum, q) => sum + (distribution.counts[q] ?? 0), 0)
  const ranges = qualityRanges(metric)
  const share = (q: (typeof QUALITIES)[number]) =>
    total ? (100 * (distribution.counts[q] ?? 0)) / total : 0
  return (
    <Stack gap={4}>
      <Group justify="space-between" gap="xs">
        <Text size="sm" fw={600}>
          {metric.title}
        </Text>
        <Text size="xs" c="dimmed">
          медиана {formatNumber(distribution.median)} {metric.unit} · 10 % хуже{' '}
          {formatNumber(distribution.p10)}
        </Text>
      </Group>
      <Box
        style={{ display: 'flex', gap: 2, height: 12 }}
        role="img"
        aria-label={QUALITIES.map((q) => `${QUALITY_LABELS[q]} ${Math.round(share(q))} %`).join(
          ', ',
        )}
      >
        {QUALITIES.filter((q) => share(q) > 0).map((q, i, shown) => (
          <Tooltip
            key={q}
            label={`${QUALITY_LABELS[q]} (${ranges[q]}): ${formatNumber(share(q))} %`}
          >
            <Box
              style={{
                flex: `${share(q)} 1 0`,
                minWidth: 2,
                background: QUALITY_COLORS[q],
                borderRadius:
                  shown.length === 1
                    ? 4
                    : i === 0
                      ? '4px 0 0 4px'
                      : i === shown.length - 1
                        ? '0 4px 4px 0'
                        : 0,
              }}
            />
          </Tooltip>
        ))}
      </Box>
      <Group gap="sm">
        {QUALITIES.map((q) => (
          <Group key={q} gap={4} wrap="nowrap">
            <Box w={8} h={8} style={{ borderRadius: 2, background: QUALITY_COLORS[q] }} />
            <Text size="xs" c="dimmed">
              {Math.round(share(q))} %
            </Text>
          </Group>
        ))}
      </Group>
    </Stack>
  )
}
