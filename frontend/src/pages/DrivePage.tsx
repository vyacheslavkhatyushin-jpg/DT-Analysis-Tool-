import { Alert, Anchor, Button, Card, Table, Text } from '@mantine/core'
import { IconUpload } from '@tabler/icons-react'
import { useState } from 'react'
import { Link } from 'react-router'

import { useDriveSessions } from '../api/hooks'
import { useAuth } from '../auth/context'
import { formatDistance, formatDuration } from '../drive/drive'
import { DriveUploadModal } from '../drive/DriveUploadModal'
import { Page } from './PageLayout'

const startFormat = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

export function DrivePage() {
  const { canEdit } = useAuth()
  const sessions = useDriveSessions()
  const [uploadOpen, setUploadOpen] = useState(false)
  const rows = sessions.data ?? []

  return (
    <Page
      title="Драйв-тесты"
      description="Замеры с телефонов: трек, качество сигнала, обслуживающие соты, проблемные участки"
      actions={
        canEdit && (
          <Button leftSection={<IconUpload size={16} />} onClick={() => setUploadOpen(true)}>
            Загрузить лог
          </Button>
        )
      }
    >
      {sessions.data && rows.length === 0 ? (
        <Alert color="gray" title="Драйв-тестов пока нет">
          Загрузите лог сессии NetMonitor (.csv или .zip): кнопка «Загрузить лог».
        </Alert>
      ) : (
        <Card withBorder p={0}>
          <Table fz="sm" highlightOnHover striped>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Сессия</Table.Th>
                <Table.Th>Начало</Table.Th>
                <Table.Th ta="right">Длительность</Table.Th>
                <Table.Th ta="right">Путь</Table.Th>
                <Table.Th ta="right">Замеров</Table.Th>
                <Table.Th ta="right">Привязано к сотам</Table.Th>
                <Table.Th>Устройство</Table.Th>
                <Table.Th>Загрузил</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((s) => {
                const matched = s.radio_samples ? (100 * s.matched_samples) / s.radio_samples : 0
                return (
                  <Table.Tr key={s.id}>
                    <Table.Td>
                      <Anchor component={Link} to={`/drive/${s.id}`} size="sm">
                        {s.name}
                      </Anchor>
                    </Table.Td>
                    <Table.Td>{startFormat.format(new Date(s.started_at))}</Table.Td>
                    <Table.Td ta="right">
                      {formatDuration(Date.parse(s.ended_at) - Date.parse(s.started_at))}
                    </Table.Td>
                    <Table.Td ta="right">{formatDistance(s.distance_m)}</Table.Td>
                    <Table.Td ta="right">{s.samples}</Table.Td>
                    <Table.Td ta="right">
                      <Text span size="sm" c={matched < 95 ? 'orange.8' : undefined}>
                        {Math.round(matched)} %
                      </Text>
                    </Table.Td>
                    <Table.Td>{s.device_name ?? '—'}</Table.Td>
                    <Table.Td>{s.uploaded_by}</Table.Td>
                  </Table.Tr>
                )
              })}
            </Table.Tbody>
          </Table>
        </Card>
      )}
      <DriveUploadModal opened={uploadOpen} onClose={() => setUploadOpen(false)} />
    </Page>
  )
}
