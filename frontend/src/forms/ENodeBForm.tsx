import { Modal, NumberInput, Select, SimpleGrid, Stack, Textarea, TextInput } from '@mantine/core'
import { useForm } from '@mantine/form'

import { api, unwrap } from '../api/client'
import { type ENodeB, useInventoryMutation, useSites } from '../api/hooks'
import { notifySaved } from '../components/confirm'
import { options, STATUS_LABELS } from '../labels'
import { FormButtons } from './common'
import { handleSubmitError, num, type NumberValue, numOrEmpty, text } from './values'

type Props = { enodeb: ENodeB | null; siteId?: number; opened: boolean; onClose: () => void }

type Values = {
  site_id: string | null
  enb_id: NumberValue
  name: string
  vendor: string
  hw_model: string
  sw_version: string
  status: ENodeB['status']
  notes: string
}

const FIELDS = ['site_id', 'enb_id']

export function ENodeBForm({ enodeb, siteId, opened, onClose }: Props) {
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={enodeb ? `eNB ${enodeb.enb_id}` : 'Новый eNodeB'}
    >
      {opened && <ENodeBFormBody enodeb={enodeb} siteId={siteId} onClose={onClose} />}
    </Modal>
  )
}

function ENodeBFormBody({ enodeb, siteId, onClose }: Omit<Props, 'opened'>) {
  const sites = useSites()
  const form = useForm<Values>({
    initialValues: {
      site_id: String(enodeb?.site_id ?? siteId ?? '') || null,
      enb_id: numOrEmpty(enodeb?.enb_id),
      name: enodeb?.name ?? '',
      vendor: enodeb?.vendor ?? 'Ericsson',
      hw_model: enodeb?.hw_model ?? '',
      sw_version: enodeb?.sw_version ?? '',
      status: enodeb?.status ?? 'active',
      notes: enodeb?.notes ?? '',
    },
    validate: {
      site_id: (v) => (v ? null : 'Выберите сайт'),
      enb_id: (v) => (num(v) === null ? 'Укажите eNB ID' : null),
    },
  })

  const save = useInventoryMutation(async (values: Values) => {
    const body = {
      site_id: Number(values.site_id),
      enb_id: num(values.enb_id)!,
      name: text(values.name),
      vendor: text(values.vendor),
      hw_model: text(values.hw_model),
      sw_version: text(values.sw_version),
      status: values.status,
      notes: text(values.notes),
    }
    if (enodeb) {
      return unwrap(
        api.PATCH('/api/v1/enodebs/{enodeb_id}', {
          params: { path: { enodeb_id: enodeb.id } },
          body,
        }),
      )
    }
    return unwrap(api.POST('/api/v1/enodebs', { body }))
  })

  return (
    <form
      onSubmit={form.onSubmit((values) =>
        save.mutate(values, {
          onSuccess: () => {
            notifySaved()
            onClose()
          },
          onError: (error) => handleSubmitError(form, error, FIELDS),
        }),
      )}
    >
      <Stack>
        <SimpleGrid cols={2}>
          <Select
            label="Сайт"
            required
            searchable
            data={(sites.data ?? []).map((s) => ({ value: String(s.id), label: s.code }))}
            {...form.getInputProps('site_id')}
          />
          <NumberInput
            label="eNB ID"
            required
            min={0}
            max={1048575}
            {...form.getInputProps('enb_id')}
          />
          <TextInput label="Имя eNB" {...form.getInputProps('name')} />
          <Select
            label="Статус"
            data={options(STATUS_LABELS)}
            allowDeselect={false}
            {...form.getInputProps('status')}
          />
          <TextInput label="Производитель" {...form.getInputProps('vendor')} />
          <TextInput label="Оборудование" {...form.getInputProps('hw_model')} />
          <TextInput label="Версия ПО" {...form.getInputProps('sw_version')} />
        </SimpleGrid>
        <Textarea label="Примечание" autosize minRows={2} {...form.getInputProps('notes')} />
        <FormButtons onCancel={onClose} loading={save.isPending} />
      </Stack>
    </form>
  )
}
