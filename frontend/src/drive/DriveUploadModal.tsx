import {
  Button,
  FileInput,
  Group,
  Modal,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
} from '@mantine/core'
import { IconUpload } from '@tabler/icons-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'

import { ApiError, errorMessage } from '../api/errors'
import { type DriveImport, useDevices, useInvalidateInventory } from '../api/hooks'
import { notifyError, notifySaved } from '../components/confirm'
import { BROWSER_ZONE, zoneOptions } from '../components/timezones'

async function upload(form: FormData): Promise<DriveImport> {
  // Multipart upload: plain fetch is simpler than the typed client here.
  const response = await fetch('/api/v1/drive-sessions/import', {
    method: 'POST',
    body: form,
    credentials: 'same-origin',
  })
  const data: unknown = await response.json().catch(() => undefined)
  if (!response.ok) throw new ApiError(response.status, errorMessage(data, response.status))
  return data as DriveImport
}

export function DriveUploadModal({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const invalidate = useInvalidateInventory()
  const navigate = useNavigate()
  const devices = useDevices()
  const zones = useMemo(() => zoneOptions(), [])
  const [file, setFile] = useState<File | null>(null)
  const [timezone, setTimezone] = useState(BROWSER_ZONE)
  const [name, setName] = useState('')
  const [deviceId, setDeviceId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const run = async () => {
    if (!file) return
    const form = new FormData()
    form.append('file', file)
    form.append('timezone', timezone)
    if (name.trim()) form.append('name', name.trim())
    if (deviceId) form.append('device_id', deviceId)
    setBusy(true)
    try {
      const result = await upload(form)
      await invalidate()
      notifySaved(
        result.sessions.length === 1
          ? 'Драйв-тест загружен'
          : `Загружено сессий: ${result.sessions.length}`,
      )
      onClose()
      const first = result.sessions[0]
      if (first) navigate(`/drive/${first.id}`)
    } catch (error) {
      notifyError(error)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal opened={opened} onClose={onClose} title="Загрузка драйв-теста" size="lg">
      <Stack>
        <Text size="sm" c="dimmed">
          Лог сессии NetMonitor: файл .csv или архив .zip, как его сохраняет приложение (в архиве
          может быть несколько сессий). Один и тот же файл загружается один раз.
        </Text>
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <FileInput
            label="Файл"
            placeholder="Выберите файл"
            accept=".csv,.zip"
            value={file}
            onChange={setFile}
            clearable
            required
          />
          <Select
            label="Часовой пояс телефона"
            description="Время в логе — время телефона"
            data={zones}
            value={timezone}
            onChange={(v) => v && setTimezone(v)}
            searchable
            allowDeselect={false}
          />
          <TextInput
            label="Название"
            placeholder="по имени файла"
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            maxLength={128}
          />
          <Select
            label="Устройство"
            placeholder="не указано"
            data={(devices.data ?? []).map((d) => ({ value: String(d.id), label: d.name }))}
            value={deviceId}
            onChange={setDeviceId}
            searchable
            clearable
          />
        </SimpleGrid>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Отмена
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
      </Stack>
    </Modal>
  )
}
