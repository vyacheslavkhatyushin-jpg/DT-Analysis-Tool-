import { Badge, Group, Stack, Text, Timeline } from '@mantine/core'

import { useChanges } from '../api/hooks'
import { ACTION_LABELS, fieldLabel, formatDateTime, formatValue, SOURCE_LABELS } from '../labels'

type Props = { entityType: string; entityId: number; limit?: number }

export function ChangeHistory({ entityType, entityId, limit = 50 }: Props) {
  const { data, isPending } = useChanges({ entity_type: entityType, entity_id: entityId, limit })
  if (isPending) return <Text c="dimmed">Загрузка…</Text>
  if (!data?.length) return <Text c="dimmed">Изменений нет</Text>
  return (
    <Timeline bulletSize={12} lineWidth={2}>
      {data.map((change) => (
        <Timeline.Item
          key={change.id}
          title={
            <Group gap="xs">
              <Text size="sm" fw={600}>
                {ACTION_LABELS[change.action] ?? change.action}
              </Text>
              <Badge size="xs" variant="light" color="gray">
                {SOURCE_LABELS[change.source] ?? change.source}
              </Badge>
            </Group>
          }
        >
          <Text size="xs" c="dimmed">
            {formatDateTime(change.ts)} · {change.username ?? 'система'}
          </Text>
          {change.action === 'update' && <ChangeDiff changes={change.changes} />}
        </Timeline.Item>
      ))}
    </Timeline>
  )
}

export function ChangeDiff({ changes }: { changes: Record<string, unknown> }) {
  return (
    <Stack gap={0} mt={4}>
      {Object.entries(changes).map(([field, pair]) => {
        const [before, after] = Array.isArray(pair) ? pair : [undefined, pair]
        return (
          <Text size="xs" key={field}>
            {fieldLabel(field)}: {formatValue(before)} → <b>{formatValue(after)}</b>
          </Text>
        )
      })}
    </Stack>
  )
}
