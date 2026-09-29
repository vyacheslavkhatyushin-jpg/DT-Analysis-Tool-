import { Modal, NumberInput, Select, SimpleGrid, Stack, Textarea, TextInput } from '@mantine/core'
import { useForm } from '@mantine/form'
import { useState } from 'react'

import { api, unwrap } from '../api/client'
import { type Site, useInventoryMutation } from '../api/hooks'
import { notifySaved } from '../components/confirm'
import { options, SITE_KIND_LABELS, STATUS_LABELS } from '../labels'
import { EffectiveAtInput, FormButtons } from './common'
import { handleSubmitError, num, type NumberValue, numOrEmpty, text, toIso } from './values'

type Props = { site: Site | null; opened: boolean; onClose: () => void }

type Values = {
  code: string
  name: string
  kind: Site['kind']
  status: Site['status']
  lat: NumberValue
  lon: NumberValue
  structure_type: string
  structure_height_m: NumberValue
  ground_elevation_m: NumberValue
  notes: string
}

const FIELDS = ['code', 'lat', 'lon', 'effective_at']

export function SiteForm({ site, opened, onClose }: Props) {
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={site ? `Сайт ${site.code}` : 'Новый сайт'}
      size="lg"
    >
      {opened && <SiteFormBody site={site} onClose={onClose} />}
    </Modal>
  )
}

function SiteFormBody({ site, onClose }: { site: Site | null; onClose: () => void }) {
  const [effectiveAt, setEffectiveAt] = useState<string | null>(null)
  const form = useForm<Values>({
    initialValues: {
      code: site?.code ?? '',
      name: site?.name ?? '',
      kind: site?.kind ?? 'stationary',
      status: site?.status ?? 'active',
      lat: numOrEmpty(site?.lat),
      lon: numOrEmpty(site?.lon),
      structure_type: site?.structure_type ?? '',
      structure_height_m: numOrEmpty(site?.structure_height_m),
      ground_elevation_m: numOrEmpty(site?.ground_elevation_m),
      notes: site?.notes ?? '',
    },
    validate: {
      code: (v) => (v.trim() ? null : 'Укажите код сайта'),
      lat: (v) => (num(v) === null ? 'Укажите широту' : null),
      lon: (v) => (num(v) === null ? 'Укажите долготу' : null),
    },
  })

  const save = useInventoryMutation(async (values: Values) => {
    const body = {
      code: values.code.trim(),
      name: text(values.name),
      kind: values.kind,
      status: values.status,
      lat: num(values.lat)!,
      lon: num(values.lon)!,
      structure_type: text(values.structure_type),
      structure_height_m: num(values.structure_height_m),
      ground_elevation_m: num(values.ground_elevation_m),
      notes: text(values.notes),
    }
    if (site) {
      return unwrap(
        api.PATCH('/api/v1/sites/{site_id}', {
          params: { path: { site_id: site.id } },
          body: { ...body, effective_at: toIso(effectiveAt) },
        }),
      )
    }
    return unwrap(api.POST('/api/v1/sites', { body }))
  })

  const moved =
    site !== null && (num(form.values.lat) !== site.lat || num(form.values.lon) !== site.lon)

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
          <TextInput label="Код сайта" required {...form.getInputProps('code')} />
          <TextInput label="Название" {...form.getInputProps('name')} />
          <Select
            label="Тип площадки"
            data={options(SITE_KIND_LABELS)}
            allowDeselect={false}
            {...form.getInputProps('kind')}
          />
          <Select
            label="Статус"
            data={options(STATUS_LABELS)}
            allowDeselect={false}
            {...form.getInputProps('status')}
          />
          <NumberInput
            label="Широта"
            required
            decimalScale={7}
            min={-90}
            max={90}
            {...form.getInputProps('lat')}
          />
          <NumberInput
            label="Долгота"
            required
            decimalScale={7}
            min={-180}
            max={180}
            {...form.getInputProps('lon')}
          />
          <TextInput
            label="Тип опоры"
            placeholder="мачта, башня, прицеп-мачта"
            {...form.getInputProps('structure_type')}
          />
          <NumberInput
            label="Высота опоры, м"
            min={0}
            {...form.getInputProps('structure_height_m')}
          />
          <NumberInput label="Отметка земли, м" {...form.getInputProps('ground_elevation_m')} />
        </SimpleGrid>
        {moved && (
          <EffectiveAtInput
            value={effectiveAt}
            onChange={setEffectiveAt}
            description="Когда сайт переехал: история положений нужна для привязки старых замеров"
          />
        )}
        <Textarea label="Примечание" autosize minRows={2} {...form.getInputProps('notes')} />
        <FormButtons onCancel={onClose} loading={save.isPending} />
      </Stack>
    </form>
  )
}
