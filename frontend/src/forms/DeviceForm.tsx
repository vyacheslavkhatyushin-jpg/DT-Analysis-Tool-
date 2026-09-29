import { Alert, Modal, Select, SimpleGrid, Stack, Textarea, TextInput } from '@mantine/core'
import { useForm } from '@mantine/form'

import { api, unwrap } from '../api/client'
import { type Device, useAssets, useInventoryMutation } from '../api/hooks'
import { notifySaved } from '../components/confirm'
import { DEVICE_KIND_LABELS, options, STATUS_LABELS } from '../labels'
import { FormButtons } from './common'
import { handleSubmitError, text } from './values'

type Props = { device: Device | null; opened: boolean; onClose: () => void }
type Values = {
  name: string
  kind: Device['kind']
  status: Device['status']
  imei: string
  imsi: string
  iccid: string
  model: string
  asset_id: string | null
  role: string
  notes: string
}

const digits = (min: number, max: number, what: string) => (v: string) =>
  !v.trim() || new RegExp(`^\\d{${min},${max}}$`).test(v.trim())
    ? null
    : `${what}: ${min === max ? min : `${min}–${max}`} цифр`

export function DeviceForm({ device, opened, onClose }: Props) {
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={device ? device.name : 'Новое устройство'}
      size="lg"
    >
      {opened && <DeviceFormBody device={device} onClose={onClose} />}
    </Modal>
  )
}

function DeviceFormBody({ device, onClose }: Omit<Props, 'opened'>) {
  const assets = useAssets()
  const form = useForm<Values>({
    initialValues: {
      name: device?.name ?? '',
      kind: device?.kind ?? 'router',
      status: device?.status ?? 'active',
      imei: device?.imei ?? '',
      imsi: device?.imsi ?? '',
      iccid: device?.iccid ?? '',
      model: device?.model ?? '',
      asset_id: device?.asset_id != null ? String(device.asset_id) : null,
      role: device?.role ?? '',
      notes: device?.notes ?? '',
    },
    validate: {
      name: (v) => (v.trim() ? null : 'Укажите название'),
      imei: digits(15, 15, 'IMEI'),
      imsi: digits(14, 15, 'IMSI'),
      iccid: digits(18, 22, 'ICCID'),
    },
  })
  const save = useInventoryMutation(async (values: Values) => {
    const body = {
      name: values.name.trim(),
      kind: values.kind,
      status: values.status,
      imei: text(values.imei),
      imsi: text(values.imsi),
      iccid: text(values.iccid),
      model: text(values.model),
      asset_id: values.asset_id ? Number(values.asset_id) : null,
      role: text(values.role),
      notes: text(values.notes),
    }
    if (device) {
      return unwrap(
        api.PATCH('/api/v1/devices/{device_id}', {
          params: { path: { device_id: device.id } },
          body,
        }),
      )
    }
    return unwrap(api.POST('/api/v1/devices', { body }))
  })
  return (
    <form
      onSubmit={form.onSubmit((values) =>
        save.mutate(values, {
          onSuccess: () => {
            notifySaved()
            onClose()
          },
          onError: (error) => handleSubmitError(form, error, ['name', 'imei', 'imsi', 'iccid']),
        }),
      )}
    >
      <Stack>
        <SimpleGrid cols={2}>
          <TextInput label="Название" required {...form.getInputProps('name')} />
          <Select
            label="Тип"
            data={options(DEVICE_KIND_LABELS)}
            allowDeselect={false}
            {...form.getInputProps('kind')}
          />
          <TextInput label="IMEI" {...form.getInputProps('imei')} />
          <TextInput label="Модель" {...form.getInputProps('model')} />
          <TextInput label="IMSI" {...form.getInputProps('imsi')} />
          <TextInput label="ICCID" {...form.getInputProps('iccid')} />
          <Select
            label="Техника"
            searchable
            clearable
            data={(assets.data ?? []).map((a) => ({ value: String(a.id), label: a.name }))}
            {...form.getInputProps('asset_id')}
          />
          <Select
            label="Статус"
            data={options(STATUS_LABELS)}
            allowDeselect={false}
            {...form.getInputProps('status')}
          />
          <TextInput
            label="Роль"
            placeholder="горный мастер, диспетчер…"
            {...form.getInputProps('role')}
          />
        </SimpleGrid>
        <Alert variant="light" color="gray" p="xs">
          Устройство привязывается к технике или роли, а не к ФИО: треки сотрудников — персональные
          данные.
        </Alert>
        <Textarea label="Примечание" autosize minRows={2} {...form.getInputProps('notes')} />
        <FormButtons onCancel={onClose} loading={save.isPending} />
      </Stack>
    </form>
  )
}
