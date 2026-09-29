import { Button, SegmentedControl } from '@mantine/core'
import { IconPlus } from '@tabler/icons-react'
import { useMemo, useState } from 'react'

import { api, unwrap } from '../api/client'
import { type Device, useAssets, useDevices, useInventoryMutation } from '../api/hooks'
import { useAuth } from '../auth/context'
import { confirmDelete, notifyError, notifySaved } from '../components/confirm'
import { type Column, DataTable } from '../components/DataTable'
import { DeleteAction, EditAction } from '../components/RowActions'
import { DeviceForm } from '../forms/DeviceForm'
import { DEVICE_KIND_LABELS, STATUS_LABELS } from '../labels'
import { Page } from './PageLayout'

export function DevicesPage() {
  const { canEdit } = useAuth()
  const devices = useDevices()
  const assets = useAssets()
  const [kind, setKind] = useState('all')
  const [editing, setEditing] = useState<{ device: Device | null } | null>(null)
  const remove = useInventoryMutation((id: number) =>
    unwrap(api.DELETE('/api/v1/devices/{device_id}', { params: { path: { device_id: id } } })),
  )
  const assetName = useMemo(
    () => new Map((assets.data ?? []).map((a) => [a.id, a.name])),
    [assets.data],
  )
  const rows = useMemo(
    () => (devices.data ?? []).filter((d) => kind === 'all' || d.kind === kind),
    [devices.data, kind],
  )
  const columns: Column<Device>[] = [
    { key: 'name', header: 'Название', value: (d) => d.name, render: (d) => <b>{d.name}</b> },
    { key: 'kind', header: 'Тип', value: (d) => DEVICE_KIND_LABELS[d.kind] },
    { key: 'model', header: 'Модель', value: (d) => d.model },
    { key: 'imei', header: 'IMEI', value: (d) => d.imei },
    {
      key: 'asset',
      header: 'Техника',
      value: (d) => (d.asset_id != null ? assetName.get(d.asset_id) : null),
    },
    { key: 'role', header: 'Роль', value: (d) => d.role },
    { key: 'status', header: 'Статус', value: (d) => STATUS_LABELS[d.status] },
  ]
  const onDelete = (device: Device) => {
    if (!confirmDelete(`устройство ${device.name}`)) return
    remove.mutate(device.id, { onSuccess: () => notifySaved('Удалено'), onError: notifyError })
  }
  return (
    <Page
      title="Устройства"
      description="Абонентские устройства: роутеры техники, рации, телефоны для драйв-тестов, стационарные зонды."
      actions={
        canEdit && (
          <Button leftSection={<IconPlus size={16} />} onClick={() => setEditing({ device: null })}>
            Добавить
          </Button>
        )
      }
    >
      <SegmentedControl
        value={kind}
        onChange={setKind}
        data={[
          { value: 'all', label: 'Все' },
          ...Object.entries(DEVICE_KIND_LABELS).map(([value, label]) => ({ value, label })),
        ]}
        w="fit-content"
      />
      <DataTable
        rows={rows}
        loading={devices.isPending}
        columns={columns}
        rowKey={(d) => d.id}
        actions={
          canEdit
            ? (d) => (
                <>
                  <EditAction onClick={() => setEditing({ device: d })} />
                  <DeleteAction onClick={() => onDelete(d)} />
                </>
              )
            : undefined
        }
      />
      <DeviceForm
        device={editing?.device ?? null}
        opened={editing !== null}
        onClose={() => setEditing(null)}
      />
    </Page>
  )
}
