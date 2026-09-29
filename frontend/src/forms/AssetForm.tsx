import { Modal, Select, Stack, Textarea, TextInput } from '@mantine/core'
import { useForm } from '@mantine/form'

import { api, unwrap } from '../api/client'
import { type Asset, useInventoryMutation } from '../api/hooks'
import { notifySaved } from '../components/confirm'
import { ASSET_KIND_LABELS, options } from '../labels'
import { FormButtons } from './common'
import { handleSubmitError, text } from './values'

type Props = { asset: Asset | null; opened: boolean; onClose: () => void }
type Values = { name: string; kind: Asset['kind']; model: string; notes: string }

export function AssetForm({ asset, opened, onClose }: Props) {
  return (
    <Modal opened={opened} onClose={onClose} title={asset ? asset.name : 'Новая техника'}>
      {opened && <AssetFormBody asset={asset} onClose={onClose} />}
    </Modal>
  )
}

function AssetFormBody({ asset, onClose }: Omit<Props, 'opened'>) {
  const form = useForm<Values>({
    initialValues: {
      name: asset?.name ?? '',
      kind: asset?.kind ?? 'haul_truck',
      model: asset?.model ?? '',
      notes: asset?.notes ?? '',
    },
    validate: { name: (v) => (v.trim() ? null : 'Укажите бортовой номер') },
  })
  const save = useInventoryMutation(async (values: Values) => {
    const body = {
      name: values.name.trim(),
      kind: values.kind,
      model: text(values.model),
      notes: text(values.notes),
    }
    if (asset) {
      return unwrap(
        api.PATCH('/api/v1/assets/{asset_id}', { params: { path: { asset_id: asset.id } }, body }),
      )
    }
    return unwrap(api.POST('/api/v1/assets', { body }))
  })
  return (
    <form
      onSubmit={form.onSubmit((values) =>
        save.mutate(values, {
          onSuccess: () => {
            notifySaved()
            onClose()
          },
          onError: (error) => handleSubmitError(form, error, ['name']),
        }),
      )}
    >
      <Stack>
        <TextInput label="Бортовой номер" required {...form.getInputProps('name')} />
        <Select
          label="Тип"
          data={options(ASSET_KIND_LABELS)}
          allowDeselect={false}
          {...form.getInputProps('kind')}
        />
        <TextInput label="Модель" {...form.getInputProps('model')} />
        <Textarea label="Примечание" autosize minRows={2} {...form.getInputProps('notes')} />
        <FormButtons onCancel={onClose} loading={save.isPending} />
      </Stack>
    </form>
  )
}
