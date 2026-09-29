import { Button } from '@mantine/core'
import { IconPlus } from '@tabler/icons-react'
import { useMemo, useState } from 'react'

import { api, unwrap } from '../api/client'
import { type Asset, useAssets, useDevices, useInventoryMutation } from '../api/hooks'
import { useAuth } from '../auth/context'
import { confirmDelete, notifyError, notifySaved } from '../components/confirm'
import { type Column, DataTable } from '../components/DataTable'
import { DeleteAction, EditAction } from '../components/RowActions'
import { AssetForm } from '../forms/AssetForm'
import { ASSET_KIND_LABELS } from '../labels'
import { Page } from './PageLayout'

export function AssetsPage() {
  const { canEdit } = useAuth()
  const assets = useAssets()
  const devices = useDevices()
  const [editing, setEditing] = useState<{ asset: Asset | null } | null>(null)
  const remove = useInventoryMutation((id: number) =>
    unwrap(api.DELETE('/api/v1/assets/{asset_id}', { params: { path: { asset_id: id } } })),
  )
  const devicesByAsset = useMemo(() => {
    const map = new Map<number, string[]>()
    for (const d of devices.data ?? []) {
      if (d.asset_id !== null && d.asset_id !== undefined)
        map.set(d.asset_id, [...(map.get(d.asset_id) ?? []), d.name])
    }
    return map
  }, [devices.data])

  const columns: Column<Asset>[] = [
    { key: 'name', header: 'Бортовой №', value: (a) => a.name, render: (a) => <b>{a.name}</b> },
    { key: 'kind', header: 'Тип', value: (a) => ASSET_KIND_LABELS[a.kind] },
    { key: 'model', header: 'Модель', value: (a) => a.model },
    {
      key: 'devices',
      header: 'Устройства',
      value: (a) => (devicesByAsset.get(a.id) ?? []).join(', '),
    },
    { key: 'notes', header: 'Примечание', value: (a) => a.notes },
  ]
  const onDelete = (asset: Asset) => {
    if (!confirmDelete(`технику ${asset.name}`)) return
    remove.mutate(asset.id, { onSuccess: () => notifySaved('Удалено'), onError: notifyError })
  }
  return (
    <Page
      title="Техника"
      description="Горная техника и транспорт. К ним привязываются LTE-роутеры и рации."
      actions={
        canEdit && (
          <Button leftSection={<IconPlus size={16} />} onClick={() => setEditing({ asset: null })}>
            Добавить
          </Button>
        )
      }
    >
      <DataTable
        rows={assets.data}
        loading={assets.isPending}
        columns={columns}
        rowKey={(a) => a.id}
        actions={
          canEdit
            ? (a) => (
                <>
                  <EditAction onClick={() => setEditing({ asset: a })} />
                  <DeleteAction onClick={() => onDelete(a)} />
                </>
              )
            : undefined
        }
      />
      <AssetForm
        asset={editing?.asset ?? null}
        opened={editing !== null}
        onClose={() => setEditing(null)}
      />
    </Page>
  )
}
