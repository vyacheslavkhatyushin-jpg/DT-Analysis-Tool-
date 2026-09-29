import {
  Alert,
  Badge,
  Button,
  Card,
  FileInput,
  Group,
  List,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core'
import { IconDownload, IconFileSpreadsheet, IconUpload } from '@tabler/icons-react'
import { useState } from 'react'

import { ApiError, errorMessage } from '../api/errors'
import { type ImportReport, useInvalidateInventory } from '../api/hooks'
import { useAuth } from '../auth/context'
import { notifyError, notifySaved } from '../components/confirm'
import { EffectiveAtInput } from '../forms/common'
import { toIso } from '../forms/values'
import { Page } from './PageLayout'

async function upload(
  file: File,
  dryRun: boolean,
  effectiveAt: string | null,
): Promise<ImportReport> {
  const body = new FormData()
  body.append('file', file)
  body.append('dry_run', String(dryRun))
  const iso = toIso(effectiveAt)
  if (iso) body.append('effective_at', iso)
  // Multipart upload: plain fetch is simpler than the typed client here.
  const response = await fetch('/api/v1/inventory/import', {
    method: 'POST',
    body,
    credentials: 'same-origin',
  })
  const data: unknown = await response.json().catch(() => undefined)
  if (!response.ok) throw new ApiError(response.status, errorMessage(data, response.status))
  return data as ImportReport
}

export function ImportPage() {
  const { canEdit } = useAuth()
  const invalidate = useInvalidateInventory()
  const [file, setFile] = useState<File | null>(null)
  const [effectiveAt, setEffectiveAt] = useState<string | null>(null)
  const [report, setReport] = useState<ImportReport | null>(null)
  const [busy, setBusy] = useState(false)

  const run = async (dryRun: boolean) => {
    if (!file) return
    setBusy(true)
    try {
      const result = await upload(file, dryRun, effectiveAt)
      setReport(result)
      if (result.applied) {
        notifySaved('Изменения применены')
        await invalidate()
      }
    } catch (error) {
      notifyError(error)
    } finally {
      setBusy(false)
    }
  }

  const hasChanges = report?.sheets.some((s) => s.created + s.updated > 0) ?? false

  return (
    <Page
      title="Импорт и экспорт"
      description="Инвентарь в Excel: выгрузка, шаблон и загрузка с предварительной проверкой."
    >
      <SimpleGrid cols={{ base: 1, md: 2 }}>
        <Card withBorder>
          <Stack>
            <Title order={5}>Выгрузка</Title>
            <Text size="sm" c="dimmed">
              Полный инвентарь в формате шаблона: его можно отредактировать и загрузить обратно.
            </Text>
            <Group>
              <Button
                component="a"
                href="/api/v1/inventory/export.xlsx"
                leftSection={<IconDownload size={16} />}
              >
                Выгрузить инвентарь
              </Button>
              <Button
                component="a"
                href="/api/v1/inventory/template.xlsx"
                variant="default"
                leftSection={<IconFileSpreadsheet size={16} />}
              >
                Пустой шаблон
              </Button>
            </Group>
          </Stack>
        </Card>
        <Card withBorder>
          <Stack>
            <Title order={5}>Загрузка</Title>
            {!canEdit && <Alert color="gray">Загрузка доступна инженерам и администраторам.</Alert>}
            <FileInput
              label="Файл .xlsx"
              placeholder="Выберите файл"
              accept=".xlsx"
              value={file}
              onChange={(f) => {
                setFile(f)
                setReport(null)
              }}
              disabled={!canEdit}
              clearable
            />
            <EffectiveAtInput
              value={effectiveAt}
              onChange={setEffectiveAt}
              description="Для изменений из выгрузки оператора: дата, когда они вступили в силу в сети"
            />
            <Group>
              <Button
                variant="default"
                onClick={() => run(true)}
                loading={busy}
                disabled={!file || !canEdit}
              >
                Проверить
              </Button>
              <Button
                leftSection={<IconUpload size={16} />}
                onClick={() => run(false)}
                loading={busy}
                disabled={
                  !file ||
                  !canEdit ||
                  !report ||
                  !report.dry_run ||
                  report.total_errors > 0 ||
                  !hasChanges
                }
              >
                Применить
              </Button>
            </Group>
            <Text size="xs" c="dimmed">
              Сначала проверка: она показывает, что будет создано и изменено. Применить можно только
              файл без ошибок.
            </Text>
          </Stack>
        </Card>
      </SimpleGrid>
      {report && <ImportResult report={report} />}
    </Page>
  )
}

function ImportResult({ report }: { report: ImportReport }) {
  return (
    <Card withBorder>
      <Stack>
        <Group>
          <Title order={5}>{report.applied ? 'Изменения применены' : 'Результат проверки'}</Title>
          {report.total_errors > 0 ? (
            <Badge color="red" variant="light">
              ошибок: {report.total_errors}
            </Badge>
          ) : (
            <Badge color="green" variant="light">
              без ошибок
            </Badge>
          )}
        </Group>
        <Table fz="sm" withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Лист</Table.Th>
              <Table.Th ta="right">Новых</Table.Th>
              <Table.Th ta="right">Изменённых</Table.Th>
              <Table.Th ta="right">Без изменений</Table.Th>
              <Table.Th ta="right">Ошибок</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {report.sheets.map((s) => (
              <Table.Tr key={s.sheet}>
                <Table.Td>{s.sheet}</Table.Td>
                {s.present ? (
                  <>
                    <Table.Td ta="right">{s.created}</Table.Td>
                    <Table.Td ta="right">{s.updated}</Table.Td>
                    <Table.Td ta="right">{s.unchanged}</Table.Td>
                    <Table.Td ta="right">{s.errors.length}</Table.Td>
                  </>
                ) : (
                  <Table.Td colSpan={4} c="dimmed">
                    лист отсутствует в файле
                  </Table.Td>
                )}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
        {report.sheets
          .filter((s) => s.errors.length > 0)
          .map((s) => (
            <Alert key={s.sheet} color="red" variant="light" title={`Лист «${s.sheet}»`}>
              <List size="sm">
                {s.errors.slice(0, 100).map((e, i) => (
                  <List.Item key={i}>
                    Строка {e.row}: {e.message}
                  </List.Item>
                ))}
              </List>
              {s.errors.length > 100 && <Text size="sm">…и ещё {s.errors.length - 100}</Text>}
            </Alert>
          ))}
      </Stack>
    </Card>
  )
}
