import {
  ActionIcon,
  Anchor,
  Box,
  Button,
  Group,
  Modal,
  Paper,
  SegmentedControl,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core'
import { useLocalStorage } from '@mantine/hooks'
import { IconArrowLeft, IconPencil, IconTrash } from '@tabler/icons-react'
import type { Feature, FeatureCollection, LineString, Point } from 'geojson'
import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'

import { api, unwrap } from '../api/client'
import {
  type DriveMetric,
  type DriveReport,
  type DriveSession,
  type DriveTrack,
  useDevices,
  useDriveMetrics,
  useDriveReport,
  useDriveSession,
  useDriveTrack,
  useInventoryMutation,
  useMapInventory,
} from '../api/hooks'
import { useAuth } from '../auth/context'
import { confirmDelete, notifyError, notifySaved } from '../components/confirm'
import {
  cellColors,
  type ColorBy,
  formatNumber,
  quality,
  QUALITIES,
  QUALITY_COLORS,
  QUALITY_LABELS,
  qualityRanges,
} from '../drive/drive'
import { ReportPanel } from '../drive/ReportPanel'
import { cellLabelFeatures, sectorFeatures, siteFeatures } from '../map/features'
import { boundsOf, type LonLat } from '../map/geo'
import { type FlyTarget, type InitialView, MapView } from '../map/MapView'
import { buildStyle, MUTED } from '../map/style'

const PANEL_WIDTH = 440
const LEGEND_WIDTH = 300
const padding = { top: 20, bottom: 20, left: LEGEND_WIDTH + 24, right: PANEL_WIDTH + 24 }
const clock = new Intl.DateTimeFormat('ru-RU', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

export function DriveSessionPage() {
  const id = Number(useParams().id)
  const session = useDriveSession(id)
  const report = useDriveReport(id)
  const track = useDriveTrack(id)
  const metrics = useDriveMetrics()

  if (session.isError) {
    return (
      <Box p="lg">
        <Text>Сессия не найдена.</Text>
        <Anchor component={Link} to="/drive">
          К списку драйв-тестов
        </Anchor>
      </Box>
    )
  }
  if (!session.data || !report.data || !track.data || !metrics.data) {
    return (
      <Text p="lg" c="dimmed">
        Загрузка…
      </Text>
    )
  }
  return (
    <SessionView
      session={session.data}
      report={report.data}
      track={track.data}
      metrics={metrics.data}
    />
  )
}

function SessionView({
  session,
  report,
  track,
  metrics,
}: {
  session: DriveSession
  report: DriveReport
  track: DriveTrack
  metrics: DriveMetric[]
}) {
  const inventory = useMapInventory()
  const [colorBy, setColorBy] = useLocalStorage<ColorBy>({
    key: 'drive.colorBy',
    defaultValue: 'rsrp',
  })
  const [sectorRadius] = useLocalStorage({ key: 'map.sectorRadius', defaultValue: 180 })
  const [selected, setSelected] = useState<number | null>(null) // index into the track
  const [flyTo, setFlyTo] = useState<FlyTarget | null>(null)
  const sites = useMemo(() => inventory.data ?? [], [inventory.data])
  const cells = useMemo(() => cellColors(report), [report])
  const metric = metrics.find((m) => m.code === colorBy)

  // Where each inventory cell's antenna is: the end of the point → sector line.
  const cellSite = useMemo(() => {
    const result = new Map<number, LonLat>()
    for (const site of sites)
      for (const cell of site.cells) result.set(cell.id, [site.lon, site.lat])
    return result
  }, [sites])

  const trackFeatures = useMemo<FeatureCollection<Point>>(() => {
    const colorOf = (i: number): string => {
      if (colorBy === 'cell') {
        const eci = track.eci[i]
        return eci != null ? (cells.byEci.get(eci) ?? MUTED) : MUTED
      }
      const m = metrics.find((x) => x.code === colorBy)
      const q = m ? quality(m, track[colorBy][i]) : null
      return QUALITY_COLORS[q ?? 'none']
    }
    return {
      type: 'FeatureCollection',
      features: track.seq.map((seq, i): Feature<Point> => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [track.lon[i] ?? 0, track.lat[i] ?? 0] },
        properties: { seq, color: colorOf(i) },
      })),
    }
  }, [track, colorBy, cells, metrics])

  const selectedCell = selected !== null ? (track.cell_id[selected] ?? null) : null
  const link = useMemo<FeatureCollection<LineString>>(() => {
    const target = selectedCell !== null ? cellSite.get(selectedCell) : undefined
    if (selected === null || !target) return { type: 'FeatureCollection', features: [] }
    const from: LonLat = [track.lon[selected] ?? 0, track.lat[selected] ?? 0]
    return {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: [from, target] },
          properties: {},
        },
      ],
    }
  }, [selected, selectedCell, cellSite, track])

  const style = useMemo(
    () =>
      buildStyle({
        basemap: null,
        overlays: [],
        sites: siteFeatures(sites),
        // Sectors recede to gray: the track carries the color here.
        sectors: sectorFeatures(sites, () => MUTED, sectorRadius),
        cellLabels: cellLabelFeatures(sites, sectorRadius),
        showSectors: true,
        showLabels: true,
        selection: selectedCell !== null ? { type: 'cell', id: selectedCell } : null,
        track: trackFeatures,
        trackLink: link,
        selectedPoint: selected !== null ? (track.seq[selected] ?? null) : null,
      }),
    [sites, sectorRadius, selectedCell, trackFeatures, link, selected, track.seq],
  )

  const initialView = useMemo<InitialView | null>(() => {
    const bounds = boundsOf(track.lon.map((lon, i): LonLat => [lon, track.lat[i] ?? 0]))
    return bounds ? { bounds } : null
  }, [track])

  const select = (index: number, fly = false) => {
    setSelected(index)
    if (fly) {
      setFlyTo({
        lon: track.lon[index] ?? 0,
        lat: track.lat[index] ?? 0,
        zoom: 15,
        key: Date.now(),
      })
    }
  }

  return (
    <Box pos="relative" h="100%">
      <MapView
        style={style}
        initialView={initialView}
        flyTo={flyTo}
        padding={padding}
        onSelect={(s) => {
          if (s === null) setSelected(null)
        }}
        onPoint={(seq) => {
          const index = track.seq.indexOf(seq)
          if (index >= 0) select(index)
        }}
      />
      <Paper
        pos="absolute"
        top={12}
        left={12}
        w={LEGEND_WIDTH}
        p="sm"
        shadow="sm"
        withBorder
        style={{ zIndex: 2 }}
      >
        <Stack gap="xs">
          <SegmentedControl
            size="xs"
            fullWidth
            data={[
              { value: 'rsrp', label: 'RSRP' },
              { value: 'rsrq', label: 'RSRQ' },
              { value: 'sinr', label: 'SINR' },
              { value: 'cell', label: 'Сота' },
            ]}
            value={colorBy}
            onChange={(v) => setColorBy(v as ColorBy)}
          />
          {metric ? (
            <MetricLegend metric={metric} report={report} />
          ) : (
            <Stack gap={4}>
              {cells.legend.map((c) => (
                <Group key={c.eci} gap={6} wrap="nowrap">
                  <Box
                    w={12}
                    h={12}
                    style={{ borderRadius: 2, flexShrink: 0, background: c.color }}
                  />
                  <Text size="xs" truncate>
                    {c.label}
                  </Text>
                </Group>
              ))}
            </Stack>
          )}
          {selected !== null && <PointCard track={track} index={selected} report={report} />}
        </Stack>
      </Paper>
      <Paper
        pos="absolute"
        top={12}
        right={12}
        bottom={12}
        w={PANEL_WIDTH}
        p="md"
        shadow="md"
        withBorder
        style={{ zIndex: 3, display: 'flex', flexDirection: 'column', gap: 8 }}
      >
        <SessionHeader session={session} />
        <ReportPanel
          session={session}
          report={report}
          track={track}
          metrics={metrics}
          colorBy={colorBy}
          cellColors={cells.byEci}
          selected={selected}
          onSelect={select}
        />
      </Paper>
    </Box>
  )
}

function MetricLegend({ metric, report }: { metric: DriveMetric; report: DriveReport }) {
  const ranges = qualityRanges(metric)
  const distribution = report.distributions.find((d) => d.metric === metric.code)
  const total = QUALITIES.reduce((s, q) => s + (distribution?.counts[q] ?? 0), 0) || 1
  return (
    <Stack gap={4}>
      {QUALITIES.map((q) => (
        <Group key={q} gap={6} wrap="nowrap" justify="space-between">
          <Group gap={6} wrap="nowrap">
            <Box w={12} h={12} style={{ borderRadius: 6, background: QUALITY_COLORS[q] }} />
            <Text size="xs">
              {QUALITY_LABELS[q]}: {ranges[q]}
            </Text>
          </Group>
          <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
            {Math.round((100 * (distribution?.counts[q] ?? 0)) / total)} %
          </Text>
        </Group>
      ))}
      <Group gap={6}>
        <Box w={12} h={12} style={{ borderRadius: 6, background: QUALITY_COLORS.none }} />
        <Text size="xs">{QUALITY_LABELS.none}</Text>
      </Group>
    </Stack>
  )
}

function PointCard({
  track,
  index,
  report,
}: {
  track: DriveTrack
  index: number
  report: DriveReport
}) {
  const eci = track.eci[index]
  const cell = report.cells.find((c) => c.eci === eci)
  const time = track.time[index]
  return (
    <Paper withBorder p="xs" bg="var(--mantine-color-default-hover)">
      <Text size="xs" c="dimmed">
        {time ? clock.format(new Date(time)) : ''}
      </Text>
      <Text size="sm" fw={600} ff="monospace">
        {cell?.cell_name ?? (eci != null ? `ECI ${eci} (нет в инвентаре)` : 'нет соты')}
      </Text>
      <Text size="xs">
        RSRP {formatNumber(track.rsrp[index])} · RSRQ {formatNumber(track.rsrq[index])} · SINR{' '}
        {formatNumber(track.sinr[index])} · PCI {track.pci[index] ?? '—'}
      </Text>
    </Paper>
  )
}

function SessionHeader({ session }: { session: DriveSession }) {
  const { canEdit } = useAuth()
  const navigate = useNavigate()
  const [editing, setEditing] = useState(false)
  const remove = useInventoryMutation(() =>
    unwrap(
      api.DELETE('/api/v1/drive-sessions/{session_id}', {
        params: { path: { session_id: session.id } },
      }),
    ),
  )
  const onDelete = () => {
    if (!confirmDelete(`драйв-тест «${session.name}» со всеми замерами`)) return
    remove.mutate(undefined, {
      onSuccess: () => {
        notifySaved('Драйв-тест удалён')
        navigate('/drive')
      },
      onError: notifyError,
    })
  }
  return (
    <Group justify="space-between" wrap="nowrap" align="flex-start">
      <Group gap={6} wrap="nowrap" align="flex-start">
        <ActionIcon
          component={Link}
          to="/drive"
          variant="subtle"
          aria-label="К списку драйв-тестов"
        >
          <IconArrowLeft size={18} />
        </ActionIcon>
        <Title order={5} style={{ wordBreak: 'break-all' }}>
          {session.name}
        </Title>
      </Group>
      {canEdit && (
        <Group gap={4} wrap="nowrap">
          <ActionIcon variant="subtle" onClick={() => setEditing(true)} aria-label="Изменить">
            <IconPencil size={16} />
          </ActionIcon>
          <ActionIcon
            variant="subtle"
            color="red"
            onClick={onDelete}
            loading={remove.isPending}
            aria-label="Удалить"
          >
            <IconTrash size={16} />
          </ActionIcon>
        </Group>
      )}
      <EditModal session={session} opened={editing} onClose={() => setEditing(false)} />
    </Group>
  )
}

function EditModal({
  session,
  opened,
  onClose,
}: {
  session: DriveSession
  opened: boolean
  onClose: () => void
}) {
  const devices = useDevices()
  const [name, setName] = useState(session.name)
  const [notes, setNotes] = useState(session.notes ?? '')
  const [deviceId, setDeviceId] = useState<string | null>(
    session.device_id ? String(session.device_id) : null,
  )
  const save = useInventoryMutation(() =>
    unwrap(
      api.PATCH('/api/v1/drive-sessions/{session_id}', {
        params: { path: { session_id: session.id } },
        body: { name, notes, device_id: deviceId ? Number(deviceId) : null },
      }),
    ),
  )
  return (
    <Modal opened={opened} onClose={onClose} title="Драйв-тест">
      <Stack>
        <TextInput
          label="Название"
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          maxLength={128}
          required
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
        <Textarea
          label="Примечание"
          autosize
          minRows={2}
          value={notes}
          onChange={(e) => setNotes(e.currentTarget.value)}
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Отмена
          </Button>
          <Button
            loading={save.isPending}
            disabled={!name.trim()}
            onClick={() =>
              save.mutate(undefined, {
                onSuccess: () => {
                  notifySaved()
                  onClose()
                },
                onError: notifyError,
              })
            }
          >
            Сохранить
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}
