import {
  Alert,
  Button,
  FileInput,
  Group,
  List,
  Modal,
  Select,
  SimpleGrid,
  Stack,
  Text,
} from '@mantine/core'
import { IconUpload } from '@tabler/icons-react'
import { useMemo, useState } from 'react'

import { ApiError, errorMessage } from '../api/errors'
import { type KpiImport, useInvalidateInventory } from '../api/hooks'
import { notifyError, notifySaved } from '../components/confirm'
import { plural } from '../labels'
import { formatPeriod } from './kpi'

async function upload(file: File, timezone: string): Promise<KpiImport> {
  const body = new FormData()
  body.append('file', file)
  body.append('timezone', timezone)
  // Multipart upload: plain fetch is simpler than the typed client here.
  const response = await fetch('/api/v1/kpi/import', {
    method: 'POST',
    body,
    credentials: 'same-origin',
  })
  const data: unknown = await response.json().catch(() => undefined)
  if (!response.ok) throw new ApiError(response.status, errorMessage(data, response.status))
  return data as KpiImport
}

const BROWSER_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone

function zoneOptions(): string[] {
  const zones =
    typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : []
  return [...new Set([BROWSER_ZONE, 'Asia/Almaty', 'UTC', ...zones])]
}

export function KpiUploadModal({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const invalidate = useInvalidateInventory()
  const zones = useMemo(() => zoneOptions(), [])
  const [file, setFile] = useState<File | null>(null)
  const [timezone, setTimezone] = useState<string>(BROWSER_ZONE)
  const [result, setResult] = useState<KpiImport | null>(null)
  const [busy, setBusy] = useState(false)

  const run = async () => {
    if (!file) return
    setBusy(true)
    try {
      setResult(await upload(file, timezone))
      notifySaved('Статистика загружена')
      await invalidate()
    } catch (error) {
      notifyError(error)
    } finally {
      setBusy(false)
    }
  }

  const close = () => {
    setFile(null)
    setResult(null)
    onClose()
  }

  return (
    <Modal opened={opened} onClose={close} title="Загрузка статистики KPI" size="lg">
      <Stack>
        <Text size="sm" c="dimmed">
          Почасовой отчёт оператора по сотам (.xlsx): дата, час, имя eNB, имя соты и показатели.
          Повторная загрузка тех же часов заменяет значения.
        </Text>
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <FileInput
            label="Файл отчёта"
            placeholder="Выберите файл"
            accept=".xlsx"
            value={file}
            onChange={(f) => {
              setFile(f)
              setResult(null)
            }}
            clearable
          />
          <Select
            label="Часовой пояс времени в отчёте"
            description="Обычно местное время сети"
            data={zones}
            value={timezone}
            onChange={(v) => v && setTimezone(v)}
            searchable
            allowDeselect={false}
          />
        </SimpleGrid>
        <Group justify="flex-end">
          <Button variant="default" onClick={close}>
            {result ? 'Закрыть' : 'Отмена'}
          </Button>
          <Button
            leftSection={<IconUpload size={16} />}
            onClick={run}
            loading={busy}
            disabled={!file}
          >
            Загрузить
          </Button>
        </Group>
        {busy && (
          <Text size="xs" c="dimmed">
            Файл за месяц обрабатывается около минуты.
          </Text>
        )}
        {result && <ImportSummary result={result} />}
      </Stack>
    </Modal>
  )
}

function ImportSummary({ result }: { result: KpiImport }) {
  const { file } = result
  return (
    <Stack gap="xs">
      <Alert color="green" variant="light" title="Загружено">
        <Text size="sm">
          {formatPeriod(file.period_start, file.period_end)} ·{' '}
          {plural(file.cells, 'сота', 'соты', 'сот')} ·{' '}
          {plural(file.samples, 'значение', 'значения', 'значений')} · лист «{result.sheet}»
        </Text>
        {result.new_cells.length > 0 && (
          <Text size="sm">Новых сот в статистике: {result.new_cells.length}</Text>
        )}
      </Alert>
      {result.unlinked_cells.length > 0 && (
        <Alert color="yellow" variant="light" title="Нет в инвентаре">
          <Text size="sm">
            Эти соты есть в статистике, но не найдены в инвентаре по имени. Привяжите их на странице
            KPI в разделе «Сверка с инвентарём»:
          </Text>
          <Text size="sm" ff="monospace">
            {result.unlinked_cells.join(', ')}
          </Text>
        </Alert>
      )}
      {result.unknown_columns.length > 0 && (
        <Alert color="gray" variant="light" title="Пропущенные столбцы">
          <Text size="sm">Эти показатели система пока не знает:</Text>
          <List size="sm">
            {result.unknown_columns.map((c) => (
              <List.Item key={c}>{c}</List.Item>
            ))}
          </List>
        </Alert>
      )}
    </Stack>
  )
}
