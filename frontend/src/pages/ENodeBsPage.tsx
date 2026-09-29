import { Button } from '@mantine/core'
import { IconPlus } from '@tabler/icons-react'
import { useMemo, useState } from 'react'

import { api, unwrap } from '../api/client'
import { type ENodeB, useCells, useENodeBs, useInventoryMutation, useSites } from '../api/hooks'
import { useAuth } from '../auth/context'
import { confirmDelete, notifyError, notifySaved } from '../components/confirm'
import { type Column, DataTable } from '../components/DataTable'
import { DeleteAction, EditAction } from '../components/RowActions'
import { ENodeBForm } from '../forms/ENodeBForm'
import { STATUS_LABELS } from '../labels'
import { Page } from './PageLayout'

export function ENodeBsPage() {
  const { canEdit } = useAuth()
  const enodebs = useENodeBs()
  const sites = useSites()
  const cells = useCells()
  const [editing, setEditing] = useState<{ enodeb: ENodeB | null } | null>(null)
  const remove = useInventoryMutation((id: number) =>
    unwrap(api.DELETE('/api/v1/enodebs/{enodeb_id}', { params: { path: { enodeb_id: id } } })),
  )
  const siteCode = useMemo(
    () => new Map((sites.data ?? []).map((s) => [s.id, s.code])),
    [sites.data],
  )
  const cellCount = useMemo(() => {
    const counts = new Map<number, number>()
    for (const c of cells.data ?? []) counts.set(c.enodeb_id, (counts.get(c.enodeb_id) ?? 0) + 1)
    return counts
  }, [cells.data])

  const columns: Column<ENodeB>[] = [
    { key: 'enb_id', header: 'eNB ID', value: (e) => e.enb_id, render: (e) => <b>{e.enb_id}</b> },
    { key: 'name', header: 'Имя', value: (e) => e.name },
    { key: 'site', header: 'Сайт', value: (e) => siteCode.get(e.site_id) },
    { key: 'vendor', header: 'Производитель', value: (e) => e.vendor },
    { key: 'hw', header: 'Оборудование', value: (e) => e.hw_model },
    { key: 'sw', header: 'ПО', value: (e) => e.sw_version },
    { key: 'status', header: 'Статус', value: (e) => STATUS_LABELS[e.status] },
    { key: 'cells', header: 'Сот', value: (e) => cellCount.get(e.id) ?? 0, align: 'right' },
  ]

  const onDelete = (enodeb: ENodeB) => {
    if (!confirmDelete(`eNB ${enodeb.enb_id}`)) return
    remove.mutate(enodeb.id, {
      onSuccess: () => notifySaved('eNodeB удалён'),
      onError: notifyError,
    })
  }

  return (
    <Page
      title="eNodeB"
      description="Базовые станции. Смена eNB ID пересчитывает ECI всех сот и сохраняется в их истории."
      actions={
        canEdit && (
          <Button leftSection={<IconPlus size={16} />} onClick={() => setEditing({ enodeb: null })}>
            Добавить eNodeB
          </Button>
        )
      }
    >
      <DataTable
        rows={enodebs.data}
        loading={enodebs.isPending}
        columns={columns}
        rowKey={(e) => e.id}
        actions={
          canEdit
            ? (e) => (
                <>
                  <EditAction onClick={() => setEditing({ enodeb: e })} />
                  <DeleteAction onClick={() => onDelete(e)} />
                </>
              )
            : undefined
        }
      />
      <ENodeBForm
        enodeb={editing?.enodeb ?? null}
        opened={editing !== null}
        onClose={() => setEditing(null)}
      />
    </Page>
  )
}
