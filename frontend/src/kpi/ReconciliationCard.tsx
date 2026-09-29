import {
  Badge,
  Button,
  Card,
  Checkbox,
  Collapse,
  Group,
  Select,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core'
import { useState } from 'react'

import { api, unwrap } from '../api/client'
import { type KpiReconciliation, useInventoryMutation, useKpiReconciliation } from '../api/hooks'
import { useAuth } from '../auth/context'
import { notifyError, notifySaved } from '../components/confirm'
import { plural } from '../labels'

type Unlinked = KpiReconciliation['unlinked'][number]
type CellRef = KpiReconciliation['cells_without_kpi'][number]

const cellLabel = (c: CellRef) => `${c.name ?? `#${c.id}`} · eNB ${c.enb_id} · сайт ${c.site_code}`

/** Differences between the operator's statistics and the inventory, with fixes in one click. */
export function ReconciliationCard() {
  const reconciliation = useKpiReconciliation()
  const [open, setOpen] = useState(false)
  const data = reconciliation.data
  if (!data) return null
  const issues = data.unlinked.length + data.enb_names.length + data.cells_without_kpi.length
  if (issues === 0) return null

  return (
    <Card withBorder>
      <Stack gap="md">
        <Group justify="space-between">
          <div>
            <Title order={5}>Сверка с инвентарём</Title>
            <Group gap={6} mt={4}>
              {data.unlinked.length > 0 && (
                <Badge color="yellow" variant="light" tt="none">
                  {plural(data.unlinked.length, 'сота', 'соты', 'сот')} статистики без пары
                </Badge>
              )}
              {data.enb_names.length > 0 && (
                <Badge color="yellow" variant="light" tt="none">
                  имена eNB: {data.enb_names.length}
                </Badge>
              )}
              {data.cells_without_kpi.length > 0 && (
                <Badge color="gray" variant="light" tt="none">
                  {plural(data.cells_without_kpi.length, 'сота', 'соты', 'сот')} инвентаря без
                  статистики
                </Badge>
              )}
            </Group>
          </div>
          <Button size="xs" variant="default" onClick={() => setOpen(!open)}>
            {open ? 'Скрыть' : 'Показать'}
          </Button>
        </Group>
        <Collapse expanded={open}>
          <Stack gap="md">
            <Text size="sm" c="dimmed">
              Статистика снята с живой сети, поэтому её имена считаются верными. Привязка
              переименовывает соту инвентаря, изменение попадает в журнал.
            </Text>
            {data.unlinked.length > 0 && (
              <UnlinkedTable items={data.unlinked} spare={data.cells_without_kpi} />
            )}
            {data.enb_names.length > 0 && <EnbNames items={data.enb_names} />}
            {data.cells_without_kpi.length > 0 && (
              <div>
                <Text size="sm" fw={600}>
                  Соты инвентаря без статистики ({data.cells_without_kpi.length})
                </Text>
                <Text size="xs" c="dimmed" mb={4}>
                  Не в эфире, переименованы оператором или не попали в отчёт. Уточните у оператора.
                </Text>
                <Group gap={6}>
                  {data.cells_without_kpi.map((c) => (
                    <Badge key={c.id} variant="outline" color="gray" tt="none">
                      {c.name ?? `#${c.id}`} ({c.site_code})
                    </Badge>
                  ))}
                </Group>
              </div>
            )}
          </Stack>
        </Collapse>
      </Stack>
    </Card>
  )
}

function UnlinkedTable({ items, spare }: { items: Unlinked[]; spare: CellRef[] }) {
  return (
    <div>
      <Text size="sm" fw={600}>
        Соты статистики без пары в инвентаре ({items.length})
      </Text>
      <Text size="xs" c="dimmed" mb={4}>
        Сначала предлагаются соты того же eNB без статистики. Какая старая сота соответствует новой,
        система знать не может: сверьте азимуты с оператором.
      </Text>
      <Table fz="sm" verticalSpacing={6}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Сота в статистике</Table.Th>
            <Table.Th>eNB в статистике</Table.Th>
            <Table.Th>Сота инвентаря</Table.Th>
            <Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {items.map((item) => (
            <UnlinkedRow key={item.kpi_cell_id} item={item} spare={spare} />
          ))}
        </Table.Tbody>
      </Table>
    </div>
  )
}

function UnlinkedRow({ item, spare }: { item: Unlinked; spare: CellRef[] }) {
  const { canEdit } = useAuth()
  const [cellId, setCellId] = useState<string | null>(null)
  const [rename, setRename] = useState(true)
  const candidateIds = new Set(item.candidates.map((c) => c.id))
  const options = [
    {
      group: 'Того же eNB',
      items: item.candidates.map((c) => ({ value: String(c.id), label: cellLabel(c) })),
    },
    {
      group: 'Остальные без статистики',
      items: spare
        .filter((c) => !candidateIds.has(c.id))
        .map((c) => ({ value: String(c.id), label: cellLabel(c) })),
    },
  ].filter((g) => g.items.length > 0)

  const link = useInventoryMutation(() =>
    unwrap(
      api.PUT('/api/v1/kpi/operator-cells/{kpi_cell_id}/link', {
        params: { path: { kpi_cell_id: item.kpi_cell_id } },
        body: { cell_id: Number(cellId), rename },
      }),
    ),
  )

  return (
    <Table.Tr>
      <Table.Td ff="monospace">{item.cell_name}</Table.Td>
      <Table.Td>
        <Text size="xs" ff="monospace">
          {item.enb_name ?? '—'}
        </Text>
      </Table.Td>
      <Table.Td miw={260}>
        <Stack gap={4}>
          <Select
            size="xs"
            placeholder="Выберите соту"
            data={options}
            value={cellId}
            onChange={setCellId}
            searchable
            disabled={!canEdit}
          />
          <Checkbox
            size="xs"
            label={`Переименовать в ${item.cell_name}`}
            checked={rename}
            onChange={(e) => setRename(e.currentTarget.checked)}
            disabled={!canEdit}
          />
        </Stack>
      </Table.Td>
      <Table.Td>
        <Button
          size="xs"
          disabled={!canEdit || !cellId}
          loading={link.isPending}
          onClick={() =>
            link.mutate(undefined, {
              onSuccess: () => notifySaved(`${item.cell_name} привязана`),
              onError: notifyError,
            })
          }
        >
          Привязать
        </Button>
      </Table.Td>
    </Table.Tr>
  )
}

function EnbNames({ items }: { items: KpiReconciliation['enb_names'] }) {
  const { canEdit } = useAuth()
  const rename = useInventoryMutation((item: KpiReconciliation['enb_names'][number]) =>
    unwrap(
      api.PATCH('/api/v1/enodebs/{enodeb_id}', {
        params: { path: { enodeb_id: item.enodeb_id } },
        body: { name: item.kpi_name },
      }),
    ),
  )
  return (
    <div>
      <Text size="sm" fw={600}>
        Имена eNB отличаются ({items.length})
      </Text>
      <Table fz="sm" verticalSpacing={6}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>eNB ID</Table.Th>
            <Table.Th>В инвентаре</Table.Th>
            <Table.Th>В статистике</Table.Th>
            <Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {items.map((item) => (
            <Table.Tr key={item.enodeb_id}>
              <Table.Td>{item.enb_id}</Table.Td>
              <Table.Td ff="monospace">{item.name ?? '—'}</Table.Td>
              <Table.Td ff="monospace">{item.kpi_name}</Table.Td>
              <Table.Td>
                <Button
                  size="xs"
                  variant="default"
                  disabled={!canEdit}
                  loading={rename.isPending && rename.variables?.enodeb_id === item.enodeb_id}
                  onClick={() =>
                    rename.mutate(item, {
                      onSuccess: () => notifySaved('eNB переименован'),
                      onError: notifyError,
                    })
                  }
                >
                  Как в статистике
                </Button>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </div>
  )
}
