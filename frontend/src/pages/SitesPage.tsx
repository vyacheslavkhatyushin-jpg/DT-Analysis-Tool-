import { Badge, Button } from '@mantine/core'
import { IconPlus } from '@tabler/icons-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'

import { api, unwrap } from '../api/client'
import { type Site, useCells, useInventoryMutation, useSites } from '../api/hooks'
import { useAuth } from '../auth/context'
import { confirmDelete, notifyError, notifySaved } from '../components/confirm'
import { type Column, DataTable } from '../components/DataTable'
import { DeleteAction, EditAction, MapAction } from '../components/RowActions'
import { SiteForm } from '../forms/SiteForm'
import { SITE_KIND_LABELS, STATUS_LABELS } from '../labels'
import { Page } from './PageLayout'

export function SitesPage() {
  const { canEdit } = useAuth()
  const navigate = useNavigate()
  const sites = useSites()
  const cells = useCells()
  const [editing, setEditing] = useState<{ site: Site | null } | null>(null)
  const remove = useInventoryMutation((id: number) =>
    unwrap(api.DELETE('/api/v1/sites/{site_id}', { params: { path: { site_id: id } } })),
  )

  const cellCount = useMemo(() => {
    const counts = new Map<number, number>()
    for (const cell of cells.data ?? [])
      counts.set(cell.site_id, (counts.get(cell.site_id) ?? 0) + 1)
    return counts
  }, [cells.data])

  const columns: Column<Site>[] = [
    { key: 'code', header: 'Код', value: (s) => s.code, render: (s) => <b>{s.code}</b> },
    { key: 'name', header: 'Название', value: (s) => s.name },
    { key: 'kind', header: 'Тип', value: (s) => SITE_KIND_LABELS[s.kind] },
    {
      key: 'status',
      header: 'Статус',
      value: (s) => STATUS_LABELS[s.status],
      render: (s) => (
        <Badge variant={s.status === 'active' ? 'light' : 'outline'} color="gray">
          {STATUS_LABELS[s.status]}
        </Badge>
      ),
    },
    {
      key: 'lat',
      header: 'Широта',
      value: (s) => s.lat,
      render: (s) => s.lat.toFixed(6),
      align: 'right',
    },
    {
      key: 'lon',
      header: 'Долгота',
      value: (s) => s.lon,
      render: (s) => s.lon.toFixed(6),
      align: 'right',
    },
    { key: 'height', header: 'Опора, м', value: (s) => s.structure_height_m, align: 'right' },
    { key: 'cells', header: 'Сот', value: (s) => cellCount.get(s.id) ?? 0, align: 'right' },
  ]

  const onDelete = (site: Site) => {
    if (!confirmDelete(`сайт ${site.code}`)) return
    remove.mutate(site.id, { onSuccess: () => notifySaved('Сайт удалён'), onError: notifyError })
  }

  return (
    <Page
      title="Сайты"
      description="Площадки размещения оборудования. Перемещения передвижных мачт сохраняются в истории."
      actions={
        canEdit && (
          <Button leftSection={<IconPlus size={16} />} onClick={() => setEditing({ site: null })}>
            Добавить сайт
          </Button>
        )
      }
    >
      <DataTable
        rows={sites.data}
        loading={sites.isPending}
        columns={columns}
        rowKey={(s) => s.id}
        onRowClick={(s) => navigate(`/?site=${s.id}`)}
        actions={(s) => (
          <>
            <MapAction onClick={() => navigate(`/?site=${s.id}`)} />
            {canEdit && <EditAction onClick={() => setEditing({ site: s })} />}
            {canEdit && <DeleteAction onClick={() => onDelete(s)} />}
          </>
        )}
      />
      <SiteForm
        site={editing?.site ?? null}
        opened={editing !== null}
        onClose={() => setEditing(null)}
      />
    </Page>
  )
}
