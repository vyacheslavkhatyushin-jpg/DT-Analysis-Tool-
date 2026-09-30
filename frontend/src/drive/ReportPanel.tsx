import {
  Alert,
  Anchor,
  Badge,
  Box,
  Button,
  Group,
  Paper,
  ScrollArea,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
  UnstyledButton,
} from '@mantine/core'
import { IconAlertTriangle, IconDownload, IconRefresh } from '@tabler/icons-react'
import { useMemo } from 'react'
import { Link } from 'react-router'

import { api, unwrap } from '../api/client'
import {
  type DriveMetric,
  type DriveReport,
  type DriveSession,
  type DriveTrack,
  useInventoryMutation,
} from '../api/hooks'
import { useAuth } from '../auth/context'
import { notifyError, notifySaved } from '../components/confirm'
import { type TimePoint, TimeChart } from '../components/TimeChart'
import {
  cellLabel,
  type ColorBy,
  formatBytes,
  formatDistance,
  formatDuration,
  formatNumber,
  PROBLEM_LABELS,
  QUALITY_COLORS,
} from './drive'
import { QualityBar } from './QualityBar'

const clock = new Intl.DateTimeFormat('ru-RU', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})
const dateTime = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

type Props = {
  session: DriveSession
  report: DriveReport
  track: DriveTrack
  metrics: DriveMetric[]
  colorBy: ColorBy
  cellColors: Map<number, string>
  selected: number | null // index into the track
  onSelect: (index: number, fly?: boolean) => void
}

export function ReportPanel(props: Props) {
  const { report } = props
  const problems = report.problems.filter((p) => p.kind !== 'gap')
  return (
    <Tabs
      defaultValue="summary"
      style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
    >
      <Tabs.List>
        <Tabs.Tab value="summary">Сводка</Tabs.Tab>
        <Tabs.Tab value="problems">Проблемы ({problems.length})</Tabs.Tab>
        <Tabs.Tab value="cells">Соты ({report.cells.length})</Tabs.Tab>
        {report.unknown.length > 0 && (
          <Tabs.Tab value="unknown" leftSection={<IconAlertTriangle size={14} />}>
            Неизвестные ({report.unknown.length})
          </Tabs.Tab>
        )}
      </Tabs.List>
      <ScrollArea style={{ flex: 1 }} pt="xs">
        <Tabs.Panel value="summary">
          <Summary {...props} />
        </Tabs.Panel>
        <Tabs.Panel value="problems">
          <Problems {...props} />
        </Tabs.Panel>
        <Tabs.Panel value="cells">
          <Cells {...props} />
        </Tabs.Panel>
        <Tabs.Panel value="unknown">
          <Unknown {...props} />
        </Tabs.Panel>
      </ScrollArea>
    </Tabs>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text size="sm" fw={500}>
        {value}
      </Text>
    </div>
  )
}

function Summary({ session, report, track, metrics, colorBy, selected, onSelect }: Props) {
  const chartMetric = metrics.find((m) => m.code === (colorBy === 'cell' ? 'rsrp' : colorBy))
  const points = useMemo<TimePoint[]>(() => {
    const key = (chartMetric?.code ?? 'rsrp') as 'rsrp' | 'rsrq' | 'sinr'
    return track.time.map((t, i) => ({ time: Date.parse(t), value: track[key][i] ?? null }))
  }, [track, chartMetric])
  const thresholds = useMemo(
    () =>
      chartMetric
        ? [
            { value: chartMetric.bounds[0], color: QUALITY_COLORS.good, label: 'хорошо' },
            { value: chartMetric.bounds[2], color: QUALITY_COLORS.bad, label: 'плохо' },
          ]
        : [],
    [chartMetric],
  )
  const matched = report.with_radio ? (100 * report.matched) / report.with_radio : 0

  return (
    <Stack gap="md">
      <SimpleGrid cols={3} spacing="xs">
        <Stat label="Начало" value={dateTime.format(new Date(session.started_at))} />
        <Stat
          label="Длительность"
          value={formatDuration(Date.parse(session.ended_at) - Date.parse(session.started_at))}
        />
        <Stat label="Путь" value={formatDistance(session.distance_m)} />
        <Stat label="Замеров" value={`${report.with_radio} из ${report.samples} с`} />
        <Stat label="Привязано к сотам" value={`${Math.round(matched)} %`} />
        <Stat label="Смен соты" value={`${report.cell_changes}, пинг-понг ${report.ping_pongs}`} />
      </SimpleGrid>
      {metrics.map((m) => {
        const distribution = report.distributions.find((d) => d.metric === m.code)
        return distribution ? (
          <QualityBar key={m.code} metric={m} distribution={distribution} />
        ) : null
      })}
      {chartMetric && (
        <div>
          <Text size="sm" fw={600}>
            {chartMetric.title} по времени
          </Text>
          <Text size="xs" c="dimmed" mb={4}>
            Нажмите на график, чтобы показать точку на карте
          </Text>
          <TimeChart
            points={points}
            label={`${chartMetric.title}, ${chartMetric.unit}`}
            unit={chartMetric.unit}
            thresholds={thresholds}
            gapMs={5000}
            tooltipTime="second"
            height={170}
            onPick={(i) => onSelect(i, true)}
            cursor={selected}
          />
        </div>
      )}
      <SimpleGrid cols={3} spacing="xs">
        <Stat
          label="Сеть"
          value={[session.operator, session.plmn].filter(Boolean).join(', ') || '—'}
        />
        <Stat
          label="Трафик DL / UL"
          value={`${formatBytes(session.rx_bytes)} / ${formatBytes(session.tx_bytes)}`}
        />
        <Stat label="Устройство" value={session.device_name ?? '—'} />
      </SimpleGrid>
      {session.notes && <Text size="sm">{session.notes}</Text>}
      <Group gap="xs">
        <Button
          size="xs"
          variant="default"
          component="a"
          href={`/api/v1/drive-sessions/${session.id}/original`}
          leftSection={<IconDownload size={14} />}
        >
          Исходный файл
        </Button>
        <Text size="xs" c="dimmed">
          {session.filename}, загрузил {session.uploaded_by}
        </Text>
      </Group>
    </Stack>
  )
}

function nearestIndex(track: DriveTrack, time: string): number {
  const target = Date.parse(time)
  let best = 0
  let bestDistance = Infinity
  track.time.forEach((t, i) => {
    const distance = Math.abs(Date.parse(t) - target)
    if (distance < bestDistance) [best, bestDistance] = [i, distance]
  })
  return best
}

function Problems({ report, track, onSelect }: Props) {
  const problems = report.problems.filter((p) => p.kind !== 'gap')
  const gaps = report.problems.filter((p) => p.kind === 'gap')
  if (report.problems.length === 0) {
    return (
      <Text size="sm" c="dimmed">
        Проблемных участков не найдено.
      </Text>
    )
  }
  return (
    <Stack gap="xs">
      <Text size="xs" c="dimmed">
        Слабое покрытие: RSRP хуже −105 дБм. Помехи: RSRP не хуже −95 дБм, но SINR ниже 3 дБ —
        сигнал есть, мешают соседние соты. Учитываются участки от 5 секунд.
      </Text>
      {problems.map((p, i) => (
        <UnstyledButton key={i} onClick={() => onSelect(nearestIndex(track, midpoint(p)), true)}>
          <Paper withBorder px="sm" py={6}>
            <Group justify="space-between" wrap="nowrap">
              <div>
                <Text size="sm" fw={600}>
                  {PROBLEM_LABELS[p.kind] ?? p.kind}
                </Text>
                <Text size="xs" c="dimmed">
                  {clock.format(new Date(p.start))} · {p.seconds} с ·{' '}
                  {p.cell_name ?? 'сота не опознана'}
                </Text>
              </div>
              <Text size="xs" ta="right" style={{ whiteSpace: 'nowrap' }}>
                RSRP {formatNumber(p.rsrp_median)}
                <br />
                SINR {formatNumber(p.sinr_median)}
              </Text>
            </Group>
          </Paper>
        </UnstyledButton>
      ))}
      {gaps.length > 0 && (
        <Text size="xs" c="dimmed">
          Без измерений дольше 5 с: {gaps.length} раз, всего{' '}
          {gaps.reduce((s, g) => s + g.seconds, 0)} с (нет сети или телефон не писал лог).
        </Text>
      )}
    </Stack>
  )
}

function midpoint(p: { start: string; end: string }): string {
  return new Date((Date.parse(p.start) + Date.parse(p.end)) / 2).toISOString()
}

function Cells({ report, colorBy, cellColors }: Props) {
  const total = report.with_radio || 1
  return (
    <Table fz="xs" verticalSpacing={4}>
      <Table.Thead>
        <Table.Tr>
          <Table.Th>Сота</Table.Th>
          <Table.Th ta="right">Доля</Table.Th>
          <Table.Th ta="right">RSRP</Table.Th>
          <Table.Th ta="right">SINR</Table.Th>
          <Table.Th ta="right">Дальше всего</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {report.cells.map((c) => (
          <Table.Tr key={c.eci}>
            <Table.Td>
              <Group gap={6} wrap="nowrap">
                {colorBy === 'cell' && (
                  <Box
                    w={10}
                    h={10}
                    style={{ borderRadius: 2, flexShrink: 0, background: cellColors.get(c.eci) }}
                  />
                )}
                <div>
                  {c.cell_id !== null ? (
                    <Anchor component={Link} to={`/?cell=${c.cell_id}`} size="xs" ff="monospace">
                      {c.cell_name}
                    </Anchor>
                  ) : (
                    <Text size="xs" ff="monospace">
                      {cellLabel(c)}
                    </Text>
                  )}
                  <Text size="xs" c="dimmed">
                    PCI {c.pci ?? '—'}
                    {c.inventory_pci !== null && c.inventory_pci !== c.pci && (
                      <Text span size="xs" c="orange.8">
                        {' '}
                        (в инвентаре {c.inventory_pci})
                      </Text>
                    )}
                    {c.site_code ? ` · сайт ${c.site_code}` : ''}
                  </Text>
                </div>
              </Group>
            </Table.Td>
            <Table.Td ta="right">{Math.round((100 * c.samples) / total)} %</Table.Td>
            <Table.Td ta="right">{formatNumber(c.rsrp_median)}</Table.Td>
            <Table.Td ta="right">{formatNumber(c.sinr_median)}</Table.Td>
            <Table.Td ta="right">
              {c.max_distance_m !== null ? formatDistance(c.max_distance_m) : '—'}
            </Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  )
}

function Unknown({ session, report }: Props) {
  const { canEdit } = useAuth()
  const rematch = useInventoryMutation(() =>
    unwrap(
      api.POST('/api/v1/drive-sessions/{session_id}/rematch', {
        params: { path: { session_id: session.id } },
      }),
    ),
  )
  const renumber = useInventoryMutation(async (hint: { enodeb_id: number; new_enb_id: number }) => {
    await unwrap(
      api.PATCH('/api/v1/enodebs/{enodeb_id}', {
        params: { path: { enodeb_id: hint.enodeb_id } },
        body: { enb_id: hint.new_enb_id },
      }),
    )
    return unwrap(
      api.POST('/api/v1/drive-sessions/{session_id}/rematch', {
        params: { path: { session_id: session.id } },
      }),
    )
  })
  const hints = new Map(
    report.unknown.flatMap((u) => (u.hint ? [[u.hint.enodeb_id, u.hint] as const] : [])),
  )

  return (
    <Stack gap="sm">
      <Text size="xs" c="dimmed">
        Соты, которые телефон видел, но в инвентаре нет такого ECI (eNB ID × 256 + Cell ID).
      </Text>
      {[...hints.values()].map((hint) => (
        <Alert
          key={hint.enodeb_id}
          color="yellow"
          variant="light"
          title={`eNB ${hint.enb_id} → ${hint.new_enb_id}?`}
        >
          <Text size="sm">
            Соты eNB {hint.new_enb_id} из замера (Cell ID и PCI) совпадают с сотами eNB{' '}
            {hint.enb_id}
            {hint.name ? ` (${hint.name})` : ''} в инвентаре. Похоже, eNB ID в инвентаре указан
            неверно.
          </Text>
          {canEdit && (
            <Button
              size="xs"
              mt="xs"
              loading={renumber.isPending && renumber.variables?.enodeb_id === hint.enodeb_id}
              onClick={() =>
                renumber.mutate(hint, {
                  onSuccess: () => notifySaved(`eNB ID исправлен на ${hint.new_enb_id}`),
                  onError: notifyError,
                })
              }
            >
              Исправить на {hint.new_enb_id}
            </Button>
          )}
        </Alert>
      ))}
      <Table fz="xs" verticalSpacing={4}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>eNB ID</Table.Th>
            <Table.Th>Cell ID</Table.Th>
            <Table.Th>PCI</Table.Th>
            <Table.Th ta="right">Секунд</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {report.unknown.map((u) => (
            <Table.Tr key={u.eci}>
              <Table.Td>{u.enb_id ?? '—'}</Table.Td>
              <Table.Td>{u.local_cell_id ?? '—'}</Table.Td>
              <Table.Td>{u.pci ?? '—'}</Table.Td>
              <Table.Td ta="right">{u.samples}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      {canEdit && (
        <Group>
          <Button
            size="xs"
            variant="default"
            leftSection={<IconRefresh size={14} />}
            loading={rematch.isPending}
            onClick={() =>
              rematch.mutate(undefined, {
                onSuccess: () => notifySaved('Замеры привязаны заново'),
                onError: notifyError,
              })
            }
          >
            Привязать заново
          </Button>
          <Text size="xs" c="dimmed">
            после правки инвентаря
          </Text>
        </Group>
      )}
      {report.unknown.length === 0 && <Badge color="green">все соты опознаны</Badge>}
    </Stack>
  )
}
