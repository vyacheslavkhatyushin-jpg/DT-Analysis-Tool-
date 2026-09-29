import {
  ActionIcon,
  Button,
  Card,
  ColorInput,
  ColorSwatch,
  FileInput,
  Group,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core'
import { IconTrash, IconUpload } from '@tabler/icons-react'
import { useState } from 'react'

import { api, unwrap } from '../api/client'
import { useInventoryMutation, useOverlays } from '../api/hooks'
import { useAuth } from '../auth/context'
import { confirmDelete, notifyError, notifySaved } from '../components/confirm'
import { formatDateTime, plural } from '../labels'

type FeatureCollection = { type: 'FeatureCollection'; features: unknown[] }

async function readGeoJson(file: File): Promise<FeatureCollection> {
  let data: unknown
  try {
    data = JSON.parse(await file.text())
  } catch {
    throw new Error('Файл не является JSON')
  }
  const fc = data as Partial<FeatureCollection>
  if (fc.type !== 'FeatureCollection' || !Array.isArray(fc.features)) {
    throw new Error('Ожидается GeoJSON FeatureCollection в WGS-84 (EPSG:4326)')
  }
  return fc as FeatureCollection
}

export function OverlaysCard() {
  const { canEdit } = useAuth()
  const overlays = useOverlays()
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState('')
  const [color, setColor] = useState('#b07a3c')

  const create = useInventoryMutation(async () => {
    if (!file) throw new Error('Выберите файл')
    const geojson = await readGeoJson(file)
    return unwrap(
      api.POST('/api/v1/map/overlays', {
        body: {
          name: name.trim() || file.name.replace(/\.(geo)?json$/i, ''),
          color,
          visible_by_default: true,
          geojson,
        },
      }),
    )
  })
  const remove = useInventoryMutation((id: number) =>
    unwrap(
      api.DELETE('/api/v1/map/overlays/{overlay_id}', { params: { path: { overlay_id: id } } }),
    ),
  )

  const upload = () =>
    create.mutate(undefined, {
      onSuccess: () => {
        notifySaved('Слой добавлен')
        setFile(null)
        setName('')
      },
      onError: notifyError,
    })

  return (
    <Card withBorder>
      <Stack>
        <div>
          <Title order={5}>Слои карты</Title>
          <Text size="sm" c="dimmed">
            Контур карьера, уступы, отвалы, дороги: GeoJSON в WGS-84. Как получить его из DXF
            маркшейдерии — в docs/DEPLOYMENT.md.
          </Text>
        </div>
        {canEdit && (
          <Group align="flex-end">
            <FileInput
              label="Файл .geojson"
              placeholder="Выберите файл"
              accept=".geojson,.json,application/geo+json,application/json"
              value={file}
              onChange={setFile}
              clearable
              w={260}
            />
            <TextInput
              label="Название"
              placeholder="по имени файла"
              value={name}
              onChange={(e) => setName(e.currentTarget.value)}
              w={220}
            />
            <ColorInput label="Цвет" value={color} onChange={setColor} w={140} />
            <Button
              leftSection={<IconUpload size={16} />}
              onClick={upload}
              loading={create.isPending}
              disabled={!file}
            >
              Загрузить
            </Button>
          </Group>
        )}
        {(overlays.data ?? []).length > 0 && (
          <Table fz="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Слой</Table.Th>
                <Table.Th>Объектов</Table.Th>
                <Table.Th>Обновлён</Table.Th>
                <Table.Th w={1} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {(overlays.data ?? []).map((overlay) => {
                const features = (overlay.geojson as { features?: unknown[] }).features?.length ?? 0
                return (
                  <Table.Tr key={overlay.id}>
                    <Table.Td>
                      <Group gap={6}>
                        <ColorSwatch color={overlay.color} size={12} />
                        {overlay.name}
                      </Group>
                    </Table.Td>
                    <Table.Td>{plural(features, 'объект', 'объекта', 'объектов')}</Table.Td>
                    <Table.Td>{formatDateTime(overlay.updated_at)}</Table.Td>
                    <Table.Td>
                      {canEdit && (
                        <Tooltip label="Удалить слой">
                          <ActionIcon
                            variant="subtle"
                            color="red"
                            size="sm"
                            aria-label="Удалить слой"
                            onClick={() =>
                              confirmDelete(`слой ${overlay.name}`) &&
                              remove.mutate(overlay.id, {
                                onSuccess: () => notifySaved('Слой удалён'),
                                onError: notifyError,
                              })
                            }
                          >
                            <IconTrash size={16} />
                          </ActionIcon>
                        </Tooltip>
                      )}
                    </Table.Td>
                  </Table.Tr>
                )
              })}
            </Table.Tbody>
          </Table>
        )}
      </Stack>
    </Card>
  )
}
