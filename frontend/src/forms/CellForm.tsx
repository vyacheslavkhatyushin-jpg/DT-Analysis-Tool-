import {
  Divider,
  Modal,
  NumberInput,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core'
import { useForm } from '@mantine/form'
import { useState } from 'react'

import { api, unwrap } from '../api/client'
import { type Cell, useENodeBs, useInventoryMutation, useSites } from '../api/hooks'
import { notifySaved } from '../components/confirm'
import { options, STATUS_LABELS } from '../labels'
import { EffectiveAtInput, FormButtons } from './common'
import { handleSubmitError, num, type NumberValue, numOrEmpty, text, toIso } from './values'

type Props = { cell: Cell | null; enodebId?: number; opened: boolean; onClose: () => void }

type Values = {
  enodeb_id: string | null
  site_id: string | null
  local_cell_id: NumberValue
  name: string
  status: Cell['status']
  pci: NumberValue
  earfcn_dl: NumberValue
  earfcn_ul: NumberValue
  bandwidth_mhz: string | null
  tac: NumberValue
  max_tx_power_dbm: NumberValue
  antenna_model: string
  height_m: NumberValue
  azimuth_deg: NumberValue
  mech_tilt_deg: NumberValue
  elec_tilt_deg: NumberValue
  beamwidth_deg: NumberValue
  notes: string
}

const BANDWIDTHS = ['1.4', '3', '5', '10', '15', '20'].map((v) => ({ value: v, label: `${v} МГц` }))
const FIELDS = ['enodeb_id', 'local_cell_id', 'name', 'pci', 'earfcn_dl', 'effective_at']

export function CellForm({ cell, enodebId, opened, onClose }: Props) {
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={cell ? `Сота ${cell.name ?? cell.eci}` : 'Новая сота'}
      size="xl"
    >
      {opened && <CellFormBody cell={cell} enodebId={enodebId} onClose={onClose} />}
    </Modal>
  )
}

function CellFormBody({ cell, enodebId, onClose }: Omit<Props, 'opened'>) {
  const enodebs = useENodeBs()
  const sites = useSites()
  const [effectiveAt, setEffectiveAt] = useState<string | null>(null)
  const siteCode = new Map((sites.data ?? []).map((s) => [s.id, s.code]))

  const form = useForm<Values>({
    initialValues: {
      enodeb_id: String(cell?.enodeb_id ?? enodebId ?? '') || null,
      site_id: cell ? String(cell.site_id) : null,
      local_cell_id: numOrEmpty(cell?.local_cell_id),
      name: cell?.name ?? '',
      status: cell?.status ?? 'active',
      pci: numOrEmpty(cell?.pci),
      earfcn_dl: numOrEmpty(cell?.earfcn_dl),
      earfcn_ul: numOrEmpty(cell?.earfcn_ul),
      bandwidth_mhz: cell?.bandwidth_mhz != null ? String(cell.bandwidth_mhz) : null,
      tac: numOrEmpty(cell?.tac),
      max_tx_power_dbm: numOrEmpty(cell?.max_tx_power_dbm),
      antenna_model: cell?.antenna_model ?? '',
      height_m: numOrEmpty(cell?.height_m),
      azimuth_deg: numOrEmpty(cell?.azimuth_deg),
      mech_tilt_deg: numOrEmpty(cell?.mech_tilt_deg),
      elec_tilt_deg: numOrEmpty(cell?.elec_tilt_deg),
      beamwidth_deg: numOrEmpty(cell?.beamwidth_deg ?? (cell ? null : 65)),
      notes: cell?.notes ?? '',
    },
    validate: {
      enodeb_id: (v) => (v ? null : 'Выберите eNodeB'),
      local_cell_id: (v) => (num(v) === null ? 'Укажите Cell ID' : null),
      pci: (v) => (num(v) === null ? 'Укажите PCI' : null),
      earfcn_dl: (v) => (num(v) === null ? 'Укажите EARFCN' : null),
    },
  })

  const save = useInventoryMutation(async (values: Values) => {
    const body = {
      enodeb_id: Number(values.enodeb_id),
      local_cell_id: num(values.local_cell_id)!,
      name: text(values.name),
      status: values.status,
      pci: num(values.pci)!,
      earfcn_dl: num(values.earfcn_dl)!,
      earfcn_ul: num(values.earfcn_ul),
      bandwidth_mhz: values.bandwidth_mhz ? Number(values.bandwidth_mhz) : null,
      tac: num(values.tac),
      max_tx_power_dbm: num(values.max_tx_power_dbm),
      antenna_model: text(values.antenna_model),
      height_m: num(values.height_m),
      azimuth_deg: num(values.azimuth_deg),
      mech_tilt_deg: num(values.mech_tilt_deg),
      elec_tilt_deg: num(values.elec_tilt_deg),
      beamwidth_deg: num(values.beamwidth_deg),
      notes: text(values.notes),
    }
    // An empty installation site means "where the eNodeB is".
    const siteId = values.site_id ? Number(values.site_id) : null
    if (cell) {
      return unwrap(
        api.PATCH('/api/v1/cells/{cell_id}', {
          params: { path: { cell_id: cell.id } },
          body: {
            ...body,
            site_id: siteId ?? cell.enodeb_site_id,
            effective_at: toIso(effectiveAt),
          },
        }),
      )
    }
    return unwrap(api.POST('/api/v1/cells', { body: { ...body, site_id: siteId } }))
  })

  const enodebOptions = (enodebs.data ?? []).map((e) => ({
    value: String(e.id),
    label: `${e.enb_id}${e.name ? ` · ${e.name}` : ''} (${siteCode.get(e.site_id) ?? '?'})`,
  }))
  const selectedEnb = enodebs.data?.find((e) => String(e.id) === form.values.enodeb_id)
  const localId = num(form.values.local_cell_id)
  const eci = selectedEnb && localId !== null ? selectedEnb.enb_id * 256 + localId : null

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
        <SimpleGrid cols={3}>
          <Select
            label="eNodeB"
            required
            searchable
            data={enodebOptions}
            {...form.getInputProps('enodeb_id')}
          />
          <NumberInput
            label="Cell ID"
            required
            min={0}
            max={255}
            {...form.getInputProps('local_cell_id')}
          />
          <TextInput label="Имя соты" {...form.getInputProps('name')} />
        </SimpleGrid>
        <Text size="xs" c="dimmed">
          ECI = eNB ID × 256 + Cell ID{eci !== null ? ` = ${eci}` : ''}
        </Text>
        <Select
          label="Сайт установки антенны"
          description="Для выносных секторов и DAS в другом здании. Пусто — сайт eNodeB"
          placeholder={
            selectedEnb ? `сайт eNodeB: ${siteCode.get(selectedEnb.site_id) ?? '?'}` : 'сайт eNodeB'
          }
          searchable
          clearable
          data={(sites.data ?? []).map((s) => ({ value: String(s.id), label: s.code }))}
          {...form.getInputProps('site_id')}
        />
        <Divider label="Радио" labelPosition="left" />
        <SimpleGrid cols={3}>
          <NumberInput label="PCI" required min={0} max={503} {...form.getInputProps('pci')} />
          <NumberInput label="EARFCN DL" required min={0} {...form.getInputProps('earfcn_dl')} />
          <NumberInput label="EARFCN UL" min={0} {...form.getInputProps('earfcn_ul')} />
          <Select
            label="Полоса"
            data={BANDWIDTHS}
            clearable
            {...form.getInputProps('bandwidth_mhz')}
          />
          <NumberInput label="TAC" min={0} max={65535} {...form.getInputProps('tac')} />
          <NumberInput
            label="Мощность, дБм"
            decimalScale={1}
            {...form.getInputProps('max_tx_power_dbm')}
          />
          <Select
            label="Статус"
            data={options(STATUS_LABELS)}
            allowDeselect={false}
            {...form.getInputProps('status')}
          />
        </SimpleGrid>
        <Divider label="Антенна" labelPosition="left" />
        <SimpleGrid cols={3}>
          <TextInput label="Модель антенны" {...form.getInputProps('antenna_model')} />
          <NumberInput
            label="Высота подвеса, м"
            min={0}
            decimalScale={1}
            {...form.getInputProps('height_m')}
          />
          <NumberInput
            label="Азимут, °"
            min={0}
            max={359.9}
            decimalScale={1}
            {...form.getInputProps('azimuth_deg')}
          />
          <NumberInput
            label="Мех. тилт, °"
            min={-30}
            max={30}
            decimalScale={1}
            {...form.getInputProps('mech_tilt_deg')}
          />
          <NumberInput
            label="Эл. тилт, °"
            min={-30}
            max={30}
            decimalScale={1}
            {...form.getInputProps('elec_tilt_deg')}
          />
          <NumberInput
            label="Ширина ДН, °"
            min={1}
            max={360}
            {...form.getInputProps('beamwidth_deg')}
          />
        </SimpleGrid>
        {cell && <EffectiveAtInput value={effectiveAt} onChange={setEffectiveAt} />}
        <Textarea label="Примечание" autosize minRows={2} {...form.getInputProps('notes')} />
        <FormButtons onCancel={onClose} loading={save.isPending} />
      </Stack>
    </form>
  )
}
