import {
  ActionIcon,
  Badge,
  Button,
  CloseButton,
  Group,
  ScrollArea,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
  Title,
  Tooltip,
} from '@mantine/core'
import { IconPencil, IconPlus, IconTrash } from '@tabler/icons-react'
import { useState } from 'react'

import { api, unwrap } from '../api/client'
import {
  type Cell,
  type ENodeB,
  type Site,
  useCells,
  useCellVersions,
  useENodeBs,
  useInventoryMutation,
  useSitePositions,
  useSites,
} from '../api/hooks'
import { useAuth } from '../auth/context'
import { ChangeHistory } from '../components/ChangeHistory'
import { confirmDelete, notifyError, notifySaved } from '../components/confirm'
import { CellForm } from '../forms/CellForm'
import { ENodeBForm } from '../forms/ENodeBForm'
import { SiteForm } from '../forms/SiteForm'
import { formatDateTime, formatValue, SITE_KIND_LABELS, STATUS_LABELS } from '../labels'
import type { Selection } from './style'

type Props = { selection: NonNullable<Selection>; onSelect: (selection: Selection) => void }

export function ObjectPanel({ selection, onSelect }: Props) {
  return (
    <Stack gap="sm" h="100%">
      <Group justify="flex-end" pos="absolute" top={8} right={8}>
        <CloseButton onClick={() => onSelect(null)} aria-label="Закрыть" />
      </Group>
      {selection.type === 'site' ? (
        <SitePanel siteId={selection.id} onSelect={onSelect} />
      ) : (
        <CellPanel cellId={selection.id} onSelect={onSelect} />
      )}
    </Stack>
  )
}

function Field({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text size="sm">{formatValue(value)}</Text>
    </div>
  )
}

function SitePanel({ siteId, onSelect }: { siteId: number; onSelect: (s: Selection) => void }) {
  const { canEdit } = useAuth()
  const site = useSites().data?.find((s) => s.id === siteId)
  const enodebs = (useENodeBs().data ?? []).filter((e) => e.site_id === siteId)
  const cells = (useCells().data ?? []).filter((c) => c.site_id === siteId)
  const positions = useSitePositions(siteId)
  const [editSite, setEditSite] = useState<Site | null>(null)
  const [editEnodeb, setEditEnodeb] = useState<{ enodeb: ENodeB | null } | null>(null)
  const [newCellFor, setNewCellFor] = useState<number | null>(null)

  if (!site) return <Text c="dimmed">Загрузка…</Text>

  return (
    <>
      <Stack gap={4} pr={32}>
        <Title order={4}>{site.code}</Title>
        {site.name && <Text size="sm">{site.name}</Text>}
        <Group gap={6}>
          <Badge variant="light" color="gray">
            {SITE_KIND_LABELS[site.kind]}
          </Badge>
          <Badge variant="outline" color="dark">
            {STATUS_LABELS[site.status]}
          </Badge>
        </Group>
      </Stack>
      <SimpleGrid cols={2} spacing="xs">
        <Field label="Широта" value={site.lat.toFixed(6)} />
        <Field label="Долгота" value={site.lon.toFixed(6)} />
        <Field label="Опора" value={site.structure_type} />
        <Field label="Высота опоры, м" value={site.structure_height_m} />
      </SimpleGrid>
      {canEdit && (
        <Group gap="xs">
          <Button
            size="xs"
            variant="default"
            leftSection={<IconPencil size={14} />}
            onClick={() => setEditSite(site)}
          >
            Сайт
          </Button>
          <Button
            size="xs"
            variant="default"
            leftSection={<IconPlus size={14} />}
            onClick={() => setEditEnodeb({ enodeb: null })}
          >
            eNodeB
          </Button>
        </Group>
      )}
      <Tabs defaultValue="cells" style={{ flex: 1, minHeight: 0 }}>
        <Tabs.List>
          <Tabs.Tab value="cells">Соты ({cells.length})</Tabs.Tab>
          <Tabs.Tab value="positions">Положения</Tabs.Tab>
          <Tabs.Tab value="history">Журнал</Tabs.Tab>
        </Tabs.List>
        <ScrollArea h="calc(100% - 40px)">
          <Tabs.Panel value="cells" pt="xs">
            {enodebs.map((enodeb) => (
              <Stack key={enodeb.id} gap={4} mb="sm">
                <Group justify="space-between">
                  <Text size="sm" fw={600}>
                    eNB {enodeb.enb_id} {enodeb.name ? `· ${enodeb.name}` : ''}
                  </Text>
                  {canEdit && (
                    <Group gap={2}>
                      <Tooltip label="Изменить eNodeB">
                        <ActionIcon
                          variant="subtle"
                          size="sm"
                          onClick={() => setEditEnodeb({ enodeb })}
                        >
                          <IconPencil size={14} />
                        </ActionIcon>
                      </Tooltip>
                      <Tooltip label="Добавить соту">
                        <ActionIcon
                          variant="subtle"
                          size="sm"
                          onClick={() => setNewCellFor(enodeb.id)}
                        >
                          <IconPlus size={14} />
                        </ActionIcon>
                      </Tooltip>
                    </Group>
                  )}
                </Group>
                <Table fz="xs" highlightOnHover verticalSpacing={4}>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Сота</Table.Th>
                      <Table.Th ta="right">PCI</Table.Th>
                      <Table.Th ta="right">EARFCN</Table.Th>
                      <Table.Th ta="right">Азимут</Table.Th>
                      <Table.Th ta="right">Тилт М/Э</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {cells
                      .filter((c) => c.enodeb_id === enodeb.id)
                      .map((cell) => (
                        <Table.Tr
                          key={cell.id}
                          style={{ cursor: 'pointer' }}
                          onClick={() => onSelect({ type: 'cell', id: cell.id })}
                        >
                          <Table.Td>{cell.name ?? cell.local_cell_id}</Table.Td>
                          <Table.Td ta="right">{cell.pci}</Table.Td>
                          <Table.Td ta="right">{cell.earfcn_dl}</Table.Td>
                          <Table.Td ta="right">{formatValue(cell.azimuth_deg)}</Table.Td>
                          <Table.Td ta="right">
                            {formatValue(cell.mech_tilt_deg)}/{formatValue(cell.elec_tilt_deg)}
                          </Table.Td>
                        </Table.Tr>
                      ))}
                  </Table.Tbody>
                </Table>
              </Stack>
            ))}
            {enodebs.length === 0 && (
              <Text c="dimmed" size="sm">
                На сайте нет eNodeB
              </Text>
            )}
          </Tabs.Panel>
          <Tabs.Panel value="positions" pt="xs">
            <Table fz="xs" verticalSpacing={4}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>С</Table.Th>
                  <Table.Th>По</Table.Th>
                  <Table.Th>Координаты</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {(positions.data ?? []).map((p, i) => (
                  <Table.Tr key={i}>
                    <Table.Td>{p.valid_from ? formatDateTime(p.valid_from) : 'всегда'}</Table.Td>
                    <Table.Td>{p.valid_to ? formatDateTime(p.valid_to) : 'сейчас'}</Table.Td>
                    <Table.Td>
                      {p.lat.toFixed(5)}, {p.lon.toFixed(5)}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Tabs.Panel>
          <Tabs.Panel value="history" pt="xs">
            <ChangeHistory entityType="site" entityId={site.id} />
          </Tabs.Panel>
        </ScrollArea>
      </Tabs>
      <SiteForm site={editSite} opened={editSite !== null} onClose={() => setEditSite(null)} />
      <ENodeBForm
        enodeb={editEnodeb?.enodeb ?? null}
        siteId={site.id}
        opened={editEnodeb !== null}
        onClose={() => setEditEnodeb(null)}
      />
      <CellForm
        cell={null}
        enodebId={newCellFor ?? undefined}
        opened={newCellFor !== null}
        onClose={() => setNewCellFor(null)}
      />
    </>
  )
}

function CellPanel({ cellId, onSelect }: { cellId: number; onSelect: (s: Selection) => void }) {
  const { canEdit } = useAuth()
  const cell = useCells().data?.find((c) => c.id === cellId)
  const versions = useCellVersions(cellId)
  const [editing, setEditing] = useState<Cell | null>(null)
  const remove = useInventoryMutation((id: number) =>
    unwrap(api.DELETE('/api/v1/cells/{cell_id}', { params: { path: { cell_id: id } } })),
  )

  if (!cell) return <Text c="dimmed">Загрузка…</Text>

  const onDelete = () => {
    if (!confirmDelete(`соту ${cell.name ?? cell.eci}`)) return
    remove.mutate(cell.id, {
      onSuccess: () => {
        notifySaved('Сота удалена')
        onSelect({ type: 'site', id: cell.site_id })
      },
      onError: notifyError,
    })
  }

  return (
    <>
      <Stack gap={4} pr={32}>
        <Title order={4}>{cell.name ?? `ECI ${cell.eci}`}</Title>
        <Text
          size="sm"
          c="blue"
          style={{ cursor: 'pointer' }}
          onClick={() => onSelect({ type: 'site', id: cell.site_id })}
        >
          Сайт {cell.site_code}
        </Text>
        <Group gap={6}>
          {cell.band !== null && (
            <Badge variant="light" color="gray">
              B{cell.band} · {cell.dl_frequency_mhz} МГц
            </Badge>
          )}
          <Badge variant="outline" color="dark">
            {STATUS_LABELS[cell.status]}
          </Badge>
        </Group>
      </Stack>
      <SimpleGrid cols={3} spacing="xs">
        <Field label="ECI" value={cell.eci} />
        <Field label="eNB ID / Cell ID" value={`${cell.enb_id} / ${cell.local_cell_id}`} />
        <Field label="PCI" value={cell.pci} />
        <Field label="EARFCN DL" value={cell.earfcn_dl} />
        <Field label="EARFCN UL" value={cell.earfcn_ul} />
        <Field label="Полоса, МГц" value={cell.bandwidth_mhz} />
        <Field label="TAC" value={cell.tac} />
        <Field label="Мощность, дБм" value={cell.max_tx_power_dbm} />
        <Field label="Антенна" value={cell.antenna_model} />
        <Field label="Высота, м" value={cell.height_m} />
        <Field label="Азимут, °" value={cell.azimuth_deg} />
        <Field
          label="Тилт М / Э, °"
          value={`${formatValue(cell.mech_tilt_deg)} / ${formatValue(cell.elec_tilt_deg)}`}
        />
      </SimpleGrid>
      {canEdit && (
        <Group gap="xs">
          <Button
            size="xs"
            variant="default"
            leftSection={<IconPencil size={14} />}
            onClick={() => setEditing(cell)}
          >
            Изменить
          </Button>
          <Button
            size="xs"
            variant="default"
            color="red"
            leftSection={<IconTrash size={14} />}
            onClick={onDelete}
            loading={remove.isPending}
          >
            Удалить
          </Button>
        </Group>
      )}
      <Tabs defaultValue="versions" style={{ flex: 1, minHeight: 0 }}>
        <Tabs.List>
          <Tabs.Tab value="versions">Версии конфигурации</Tabs.Tab>
          <Tabs.Tab value="history">Журнал</Tabs.Tab>
        </Tabs.List>
        <ScrollArea h="calc(100% - 40px)">
          <Tabs.Panel value="versions" pt="xs">
            <Table fz="xs" verticalSpacing={4}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Действовала</Table.Th>
                  <Table.Th ta="right">PCI</Table.Th>
                  <Table.Th ta="right">Азимут</Table.Th>
                  <Table.Th ta="right">Тилт М/Э</Table.Th>
                  <Table.Th ta="right">Высота</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {(versions.data ?? []).map((v, i) => (
                  <Table.Tr key={i}>
                    <Table.Td>
                      {v.valid_from ? formatDateTime(v.valid_from) : 'изначально'} —{' '}
                      {v.valid_to ? formatDateTime(v.valid_to) : 'сейчас'}
                    </Table.Td>
                    <Table.Td ta="right">{v.pci}</Table.Td>
                    <Table.Td ta="right">{formatValue(v.azimuth_deg)}</Table.Td>
                    <Table.Td ta="right">
                      {formatValue(v.mech_tilt_deg)}/{formatValue(v.elec_tilt_deg)}
                    </Table.Td>
                    <Table.Td ta="right">{formatValue(v.height_m)}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Tabs.Panel>
          <Tabs.Panel value="history" pt="xs">
            <ChangeHistory entityType="cell" entityId={cell.id} />
          </Tabs.Panel>
        </ScrollArea>
      </Tabs>
      <CellForm cell={editing} opened={editing !== null} onClose={() => setEditing(null)} />
    </>
  )
}
