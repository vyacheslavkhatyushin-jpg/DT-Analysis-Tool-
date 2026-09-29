import { Button } from '@mantine/core'
import { IconPlus } from '@tabler/icons-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'

import { api, unwrap } from '../api/client'
import { type Cell, useCells, useInventoryMutation } from '../api/hooks'
import { useAuth } from '../auth/context'
import { confirmDelete, notifyError, notifySaved } from '../components/confirm'
import { type Column, DataTable } from '../components/DataTable'
import { DeleteAction, EditAction, MapAction } from '../components/RowActions'
import { CellForm } from '../forms/CellForm'
import { STATUS_LABELS } from '../labels'
import { Page } from './PageLayout'

const columns: Column<Cell>[] = [
  { key: 'name', header: 'Сота', value: (c) => c.name, render: (c) => <b>{c.name ?? '—'}</b> },
  { key: 'site', header: 'Сайт', value: (c) => c.site_code },
  { key: 'enb', header: 'eNB ID', value: (c) => c.enb_id, align: 'right' },
  { key: 'cid', header: 'Cell ID', value: (c) => c.local_cell_id, align: 'right' },
  { key: 'eci', header: 'ECI', value: (c) => c.eci, align: 'right' },
  { key: 'pci', header: 'PCI', value: (c) => c.pci, align: 'right' },
  { key: 'earfcn', header: 'EARFCN', value: (c) => c.earfcn_dl, align: 'right' },
  { key: 'band', header: 'Диапазон', value: (c) => (c.band !== null ? `B${c.band}` : null) },
  { key: 'bw', header: 'Полоса', value: (c) => c.bandwidth_mhz, align: 'right' },
  { key: 'tac', header: 'TAC', value: (c) => c.tac, align: 'right' },
  { key: 'az', header: 'Азимут', value: (c) => c.azimuth_deg, align: 'right' },
  { key: 'h', header: 'Высота', value: (c) => c.height_m, align: 'right' },
  { key: 'mt', header: 'М.тилт', value: (c) => c.mech_tilt_deg, align: 'right' },
  { key: 'et', header: 'Э.тилт', value: (c) => c.elec_tilt_deg, align: 'right' },
  { key: 'status', header: 'Статус', value: (c) => STATUS_LABELS[c.status] },
]

export function CellsPage() {
  const { canEdit } = useAuth()
  const navigate = useNavigate()
  const cells = useCells()
  const [editing, setEditing] = useState<{ cell: Cell | null } | null>(null)
  const remove = useInventoryMutation((id: number) =>
    unwrap(api.DELETE('/api/v1/cells/{cell_id}', { params: { path: { cell_id: id } } })),
  )
  const onDelete = (cell: Cell) => {
    if (!confirmDelete(`соту ${cell.name ?? cell.eci}`)) return
    remove.mutate(cell.id, { onSuccess: () => notifySaved('Сота удалена'), onError: notifyError })
  }
  return (
    <Page
      title="Соты"
      description="Изменение радиопараметров создаёт новую версию конфигурации соты с датой изменения."
      actions={
        canEdit && (
          <Button leftSection={<IconPlus size={16} />} onClick={() => setEditing({ cell: null })}>
            Добавить соту
          </Button>
        )
      }
    >
      <DataTable
        rows={cells.data}
        loading={cells.isPending}
        columns={columns}
        rowKey={(c) => c.id}
        onRowClick={(c) => navigate(`/?cell=${c.id}`)}
        actions={(c) => (
          <>
            <MapAction onClick={() => navigate(`/?cell=${c.id}`)} />
            {canEdit && <EditAction onClick={() => setEditing({ cell: c })} />}
            {canEdit && <DeleteAction onClick={() => onDelete(c)} />}
          </>
        )}
      />
      <CellForm
        cell={editing?.cell ?? null}
        opened={editing !== null}
        onClose={() => setEditing(null)}
      />
    </Page>
  )
}
