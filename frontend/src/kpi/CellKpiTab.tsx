import { Group, ScrollArea, SegmentedControl, Select, Stack, Table, Text } from '@mantine/core'
import { useLocalStorage } from '@mantine/hooks'
import { useMemo, useState } from 'react'

import { useKpiCatalogue, useKpiSeries, useKpiSummary } from '../api/hooks'
import { KpiChart } from './KpiChart'
import {
  aggregateDaily,
  type ChartPoint,
  formatKpi,
  formatPeriod,
  PERIOD_PRESETS,
  type PeriodPreset,
  presetPeriod,
  statsByCell,
  withUnit,
} from './kpi'
import { KpiValue } from './KpiValue'

const dayFormat = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit' })
const timeFormat = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})

/** Hourly KPI of one cell: a chart (or a table) and the values over the period. */
export function CellKpiTab({ cellId }: { cellId: number }) {
  const catalogue = useKpiCatalogue()
  const [kpi, setKpi] = useLocalStorage({ key: 'cell.kpi', defaultValue: 'ho_sr' })
  const [preset, setPreset] = useLocalStorage<PeriodPreset>({
    key: 'cell.kpiPeriod',
    defaultValue: '7d',
  })
  const [view, setView] = useState<'chart' | 'table'>('chart')
  // Hourly rates are noisy on quiet cells: days are the default for periods longer than a day.
  const [stepChoice, setStep] = useState<'hour' | 'day' | null>(null)
  const step = stepChoice ?? (preset === '1d' ? 'hour' : 'day')

  const base = useKpiSummary(null)
  const period = preset === '7d' ? null : presetPeriod(preset, base.data)
  const summary = useKpiSummary(period)
  const series = useKpiSeries(cellId, period)
  const def = catalogue.data?.find((d) => d.code === kpi)
  const stat = useMemo(
    () => statsByCell(summary.data?.cells ?? [], kpi).get(cellId)?.values[kpi],
    [summary.data, kpi, cellId],
  )
  const points = useMemo<ChartPoint[]>(() => {
    const hourly = (series.data?.points ?? []).map((p) => ({
      time: Date.parse(p.time),
      values: p.values,
    }))
    if (step === 'day' && def) return aggregateDaily(hourly, def)
    return hourly.map((p) => ({ time: p.time, value: p.values[kpi] ?? null }))
  }, [series.data, kpi, step, def])

  if (base.data && base.data.data_start === null) {
    return (
      <Text size="sm" c="dimmed">
        Статистики KPI пока нет: загрузите отчёт оператора на странице «KPI сети».
      </Text>
    )
  }
  if (series.data && series.data.points.length === 0 && !series.isPlaceholderData) {
    return (
      <Text size="sm" c="dimmed">
        Для этой соты нет статистики за период. Если сота в статистике называется иначе, привяжите
        её на странице «KPI сети» в разделе сверки.
      </Text>
    )
  }

  return (
    <Stack gap="xs">
      <Select
        size="xs"
        data={(catalogue.data ?? []).map((d) => ({
          value: d.code,
          label: d.unit ? `${d.title}, ${d.unit}` : d.title,
        }))}
        value={kpi}
        onChange={(v) => v && setKpi(v)}
        allowDeselect={false}
        aria-label="Показатель"
      />
      <Group justify="space-between" gap="xs">
        <SegmentedControl
          size="xs"
          data={PERIOD_PRESETS}
          value={preset}
          onChange={(v) => setPreset(v as PeriodPreset)}
        />
        <SegmentedControl
          size="xs"
          data={[
            { value: 'hour', label: 'По часам' },
            { value: 'day', label: 'По суткам' },
          ]}
          value={step}
          onChange={(v) => setStep(v as 'hour' | 'day')}
        />
      </Group>
      <SegmentedControl
        size="xs"
        data={[
          { value: 'chart', label: 'График' },
          { value: 'table', label: 'Таблица' },
        ]}
        value={view}
        onChange={(v) => setView(v as 'chart' | 'table')}
      />
      <Text size="xs" c="dimmed">
        {formatPeriod(series.data?.start ?? null, series.data?.end ?? null)}
      </Text>
      <Group gap="lg">
        <div>
          <Text size="xs" c="dimmed">
            За период{def?.unit ? `, ${def.unit}` : ''}
          </Text>
          <KpiValue value={stat?.value ?? null} level={stat?.level ?? null} def={def} />
        </div>
        {def?.better && (
          <div>
            <Text size="xs" c="dimmed">
              Худший час{def.unit ? `, ${def.unit}` : ''}
            </Text>
            <KpiValue value={stat?.worst ?? null} level={stat?.worst_level ?? null} def={def} />
          </div>
        )}
      </Group>
      <div style={{ opacity: series.isPlaceholderData ? 0.6 : 1, transition: 'opacity 150ms' }}>
        {view === 'chart' ? (
          <KpiChart points={points} def={def} step={step} />
        ) : (
          <ScrollArea h={260}>
            <Table fz="xs" verticalSpacing={2} stickyHeader>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{step === 'day' ? 'Сутки' : 'Час'}</Table.Th>
                  <Table.Th ta="right">{def?.title ?? kpi}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {[...points].reverse().map((p) => (
                  <Table.Tr key={p.time}>
                    <Table.Td>{(step === 'day' ? dayFormat : timeFormat).format(p.time)}</Table.Td>
                    <Table.Td ta="right" style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {withUnit(formatKpi(p.value, def), def)}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        )}
      </div>
    </Stack>
  )
}
