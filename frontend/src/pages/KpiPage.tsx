import {
  Alert,
  Anchor,
  Badge,
  Button,
  Card,
  Group,
  Paper,
  ScrollArea,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Tooltip,
  UnstyledButton,
} from '@mantine/core'
import { useLocalStorage } from '@mantine/hooks'
import { IconArrowDown, IconUpload } from '@tabler/icons-react'
import { type ReactNode, useMemo, useState } from 'react'
import { Link } from 'react-router'

import { type KpiCellStats, type KpiDef, useKpiCatalogue, useKpiSummary } from '../api/hooks'
import { useAuth } from '../auth/context'
import {
  formatKpi,
  formatPeriod,
  KEY_KPIS,
  levelRanges,
  PERIOD_PRESETS,
  type PeriodPreset,
  presetPeriod,
  type Statistic,
  statOf,
} from '../kpi/kpi'
import { KpiUploadModal } from '../kpi/KpiUploadModal'
import { KpiValue, LevelDot } from '../kpi/KpiValue'
import { ReconciliationCard } from '../kpi/ReconciliationCard'
import { Page } from './PageLayout'

const SHORT_TITLES: Record<string, string> = {
  availability: 'Доступн.',
  rrc_sr: 'RRC SR',
  erab_sr: 'E-RAB SR',
  erab_drop_wo_ue_lost: 'Drop',
  ho_sr: 'HO SR',
  dl_user_thp: 'DL, Мбит/с',
  ul_bler: 'UL BLER',
  ul_prb: 'UL PRB',
  dl_prb: 'DL PRB',
  dl_volume: 'DL, ГБ',
  ul_volume: 'UL, ГБ',
}

type Sort = 'problems' | (typeof KEY_KPIS)[number]

const LEVEL_SCORE = { ok: 0, warn: 1, bad: 100 } as const

/** Problems first: the number of KPIs in the red zone, then in the yellow one. */
function problemScore(cell: KpiCellStats, statistic: Statistic): number {
  let score = 0
  for (const code of KEY_KPIS) {
    const level = statOf(cell.values[code], statistic).level
    if (level) score += LEVEL_SCORE[level]
  }
  return score
}

function sortCells(
  cells: KpiCellStats[],
  sort: Sort,
  statistic: Statistic,
  defs: Map<string, KpiDef>,
): KpiCellStats[] {
  const sorted = [...cells]
  if (sort === 'problems') {
    return sorted.sort((a, b) => problemScore(b, statistic) - problemScore(a, statistic))
  }
  // Worst first; for traffic, the biggest first.
  const sign = defs.get(sort)?.better === 'high' ? 1 : -1
  const key = (c: KpiCellStats) => statOf(c.values[sort], statistic).value
  return sorted.sort((a, b) => {
    const [x, y] = [key(a), key(b)]
    if (x === null) return 1
    if (y === null) return -1
    return sign * (x - y)
  })
}

export function KpiPage() {
  const { canEdit } = useAuth()
  const catalogue = useKpiCatalogue()
  const [preset, setPreset] = useLocalStorage<PeriodPreset>({
    key: 'kpi.period',
    defaultValue: '7d',
  })
  const [statistic, setStatistic] = useLocalStorage<Statistic>({
    key: 'kpi.statistic',
    defaultValue: 'value',
  })
  const [sort, setSort] = useState<Sort>('problems')
  const [uploadOpen, setUploadOpen] = useState(false)

  // The default query (last 7 days of data) also tells where the data starts and ends.
  const base = useKpiSummary(null)
  const period = preset === '7d' ? null : presetPeriod(preset, base.data)
  const summary = useKpiSummary(period)
  const data = summary.data
  const defs = useMemo(
    () => new Map((catalogue.data ?? []).map((d) => [d.code, d])),
    [catalogue.data],
  )
  const cells = useMemo(
    () => sortCells(data?.cells ?? [], sort, statistic, defs),
    [data?.cells, sort, statistic, defs],
  )

  const problems = KEY_KPIS.flatMap((code) => {
    const def = defs.get(code)
    if (!def?.better) return []
    const levels = (data?.cells ?? []).map((c) => statOf(c.values[code], statistic).level)
    return [
      {
        code,
        def,
        bad: levels.filter((l) => l === 'bad').length,
        warn: levels.filter((l) => l === 'warn').length,
      },
    ]
  })
  const total = (code: string) =>
    (data?.cells ?? []).reduce((sum, c) => sum + (c.values[code]?.value ?? 0), 0)
  const problemCells = (data?.cells ?? []).filter((c) => problemScore(c, statistic) >= 100).length

  return (
    <Page
      title="KPI сети"
      description="Почасовая статистика оператора по сотам"
      actions={
        canEdit && (
          <Button leftSection={<IconUpload size={16} />} onClick={() => setUploadOpen(true)}>
            Загрузить отчёт
          </Button>
        )
      }
    >
      {data && data.data_start === null ? (
        <Alert color="gray" title="Статистики пока нет">
          Загрузите почасовой отчёт оператора по сотам (кнопка «Загрузить отчёт»).
        </Alert>
      ) : (
        <>
          <Group gap="md" align="center">
            <SegmentedControl
              size="xs"
              data={PERIOD_PRESETS}
              value={preset}
              onChange={(v) => setPreset(v as PeriodPreset)}
            />
            <SegmentedControl
              size="xs"
              data={[
                { value: 'value', label: 'За период' },
                { value: 'worst', label: 'Худший час' },
              ]}
              value={statistic}
              onChange={(v) => setStatistic(v as Statistic)}
            />
            <Text size="sm" c="dimmed">
              {formatPeriod(data?.start ?? null, data?.end ?? null)}
            </Text>
          </Group>
          <div
            style={{ opacity: summary.isPlaceholderData ? 0.6 : 1, transition: 'opacity 150ms' }}
          >
            <Stack gap="md">
              <SimpleGrid cols={{ base: 1, xs: 2, md: 4 }}>
                <StatTile label="Трафик DL" value={`${formatKpi(total('dl_volume'))} ГБ`} />
                <StatTile label="Трафик UL" value={`${formatKpi(total('ul_volume'))} ГБ`} />
                <StatTile
                  label="Сот в статистике"
                  value={String(data?.cells.length ?? 0)}
                  hint={`${problemCells} с хотя бы одним KPI в красной зоне`}
                />
                <StatTile
                  label="Данные есть"
                  value={formatDays(data?.data_start ?? null, data?.data_end ?? null)}
                />
              </SimpleGrid>
              <Card withBorder>
                <Text size="sm" fw={600} mb="xs">
                  Проблемы по показателям
                </Text>
                <SimpleGrid cols={{ base: 2, sm: 3, lg: 5 }} spacing="xs">
                  {problems.map((p) => (
                    <UnstyledButton
                      key={p.code}
                      onClick={() => setSort(p.code)}
                      aria-label={`${p.def.title}: сортировать таблицу`}
                    >
                      <Paper
                        withBorder
                        px="sm"
                        py={6}
                        bg={sort === p.code ? 'var(--mantine-color-default-hover)' : undefined}
                      >
                        <Text size="xs" c="dimmed" truncate>
                          {p.def.title}
                        </Text>
                        <Group gap="sm">
                          <Group gap={4} wrap="nowrap">
                            <LevelDot level="bad" />
                            <Text size="sm" fw={600}>
                              {p.bad}
                            </Text>
                          </Group>
                          <Group gap={4} wrap="nowrap">
                            <LevelDot level="warn" />
                            <Text size="sm">{p.warn}</Text>
                          </Group>
                        </Group>
                      </Paper>
                    </UnstyledButton>
                  ))}
                </SimpleGrid>
                <Text size="xs" c="dimmed" mt="xs">
                  Число сот в красной и жёлтой зоне. Нажмите на показатель, чтобы отсортировать
                  таблицу.
                </Text>
              </Card>
              <ReconciliationCard />
              <Card withBorder p={0}>
                <ScrollArea>
                  <Table fz="sm" striped highlightOnHover stickyHeader miw={1100}>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>
                          <SortHeader
                            active={sort === 'problems'}
                            onClick={() => setSort('problems')}
                          >
                            Сота
                          </SortHeader>
                        </Table.Th>
                        {KEY_KPIS.map((code) => (
                          <Table.Th key={code} ta="right">
                            <KpiHeader
                              def={defs.get(code)}
                              title={SHORT_TITLES[code] ?? code}
                              active={sort === code}
                              onClick={() => setSort(code)}
                            />
                          </Table.Th>
                        ))}
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {cells.map((cell) => (
                        <Table.Tr key={cell.kpi_cell_id}>
                          <Table.Td>
                            <CellName cell={cell} />
                          </Table.Td>
                          {KEY_KPIS.map((code) => {
                            const { value, level } = statOf(cell.values[code], statistic)
                            return (
                              <Table.Td key={code} ta="right">
                                <KpiValue value={value} level={level} def={defs.get(code)} />
                              </Table.Td>
                            )
                          })}
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </ScrollArea>
              </Card>
              <Text size="xs" c="dimmed">
                Значения за период приблизительные: оператор даёт почасовые проценты, а не счётчики.
                Скорость, хэндоверы и CQI усредняются с весом трафика часа, остальное — простым
                средним по часам. «Худший час» ненадёжен для сот с малым трафиком: один сорванный
                вызов из двух — это 50 %.
              </Text>
            </Stack>
          </div>
        </>
      )}
      <KpiUploadModal opened={uploadOpen} onClose={() => setUploadOpen(false)} />
    </Page>
  )
}

const dayOnly = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit' })

function formatDays(start: string | null, end: string | null): string {
  if (!start || !end) return 'нет данных'
  // The end is exclusive: the last hour ends at 00:00 of the next day.
  return `${dayOnly.format(new Date(start))} — ${dayOnly.format(new Date(Date.parse(end) - 1))}`
}

function StatTile({
  label,
  value,
  hint,
  small = false,
}: {
  label: string
  value: string
  hint?: string
  small?: boolean
}) {
  return (
    <Paper withBorder p="md">
      <Text size="sm" c="dimmed">
        {label}
      </Text>
      <Text fw={600} size={small ? 'md' : 'xl'}>
        {value}
      </Text>
      {hint && (
        <Text size="xs" c="dimmed">
          {hint}
        </Text>
      )}
    </Paper>
  )
}

function SortHeader({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <UnstyledButton onClick={onClick} style={{ fontWeight: 600, fontSize: 'inherit' }}>
      <Group gap={2} wrap="nowrap" justify="inherit">
        {children}
        {active && <IconArrowDown size={12} aria-label="сортировка" />}
      </Group>
    </UnstyledButton>
  )
}

function KpiHeader({
  def,
  title,
  active,
  onClick,
}: {
  def?: KpiDef
  title: string
  active: boolean
  onClick: () => void
}) {
  const ranges = def ? levelRanges(def) : null
  return (
    <Tooltip
      multiline
      w={220}
      label={
        <Stack gap={2}>
          <Text size="xs" fw={600}>
            {def?.title ?? title}
            {def?.unit ? `, ${def.unit}` : ''}
          </Text>
          {ranges &&
            (['ok', 'warn', 'bad'] as const).map((level) => (
              <Group key={level} gap={6} wrap="nowrap">
                <LevelDot level={level} />
                <Text size="xs">{ranges[level]}</Text>
              </Group>
            ))}
          <Text size="xs">Нажмите, чтобы отсортировать: худшие сверху</Text>
        </Stack>
      }
    >
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <SortHeader active={active} onClick={onClick}>
          {title}
        </SortHeader>
      </div>
    </Tooltip>
  )
}

function CellName({ cell }: { cell: KpiCellStats }) {
  return (
    <Stack gap={0}>
      {cell.cell_id !== null ? (
        <Anchor component={Link} to={`/?cell=${cell.cell_id}`} size="sm" ff="monospace">
          {cell.cell_name}
        </Anchor>
      ) : (
        <Group gap={6} wrap="nowrap">
          <Text size="sm" ff="monospace">
            {cell.cell_name}
          </Text>
          <Badge size="xs" variant="outline" color="gray">
            нет в инвентаре
          </Badge>
        </Group>
      )}
      <Text size="xs" c="dimmed" ff="monospace">
        {cell.enb_name ?? ''}
      </Text>
    </Stack>
  )
}
