import {
  ActionIcon,
  Checkbox,
  Collapse,
  ColorSwatch,
  Divider,
  Group,
  Select,
  Slider,
  Stack,
  Switch,
  Text,
} from '@mantine/core'
import { useLocalStorage } from '@mantine/hooks'
import { IconChevronDown, IconChevronUp } from '@tabler/icons-react'
import type { ReactNode } from 'react'

import type { Basemap, Overlay } from '../api/hooks'
import type { Carrier } from './carriers'
import { INK, MUTED } from './style'

type Props = {
  basemaps: Basemap[]
  basemapId: string | null
  onBasemap: (id: string | null) => void
  overlays: Overlay[]
  hiddenOverlays: Set<number>
  onToggleOverlay: (id: number) => void
  showSectors: boolean
  onShowSectors: (value: boolean) => void
  showLabels: boolean
  onShowLabels: (value: boolean) => void
  sectorRadius: number
  onSectorRadius: (value: number) => void
  carriers: Carrier[]
}

export function LayersPanel(props: Props) {
  const [open, setOpen] = useLocalStorage({ key: 'map.layersOpen', defaultValue: true })
  return (
    <Stack gap={0}>
      <Group justify="space-between" onClick={() => setOpen(!open)} style={{ cursor: 'pointer' }}>
        <Text size="sm" fw={600}>
          Слои и легенда
        </Text>
        <ActionIcon variant="subtle" size="sm" aria-label={open ? 'Свернуть' : 'Развернуть'}>
          {open ? <IconChevronUp size={16} /> : <IconChevronDown size={16} />}
        </ActionIcon>
      </Group>
      <Collapse expanded={open}>
        <LayersBody {...props} />
      </Collapse>
    </Stack>
  )
}

function LayersBody(props: Props) {
  return (
    <Stack gap="xs" pt="xs">
      <Select
        label="Подложка"
        size="xs"
        placeholder={props.basemaps.length ? 'без подложки' : 'нет файлов .pmtiles'}
        data={props.basemaps.map((b) => ({ value: b.id, label: b.name }))}
        value={props.basemapId}
        onChange={props.onBasemap}
        clearable
        disabled={props.basemaps.length === 0}
      />
      {props.overlays.length > 0 && (
        <>
          <Text size="xs" fw={600}>
            Слои
          </Text>
          {props.overlays.map((overlay) => (
            <Checkbox
              key={overlay.id}
              size="xs"
              label={
                <Group gap={6}>
                  <ColorSwatch color={overlay.color} size={10} />
                  {overlay.name}
                </Group>
              }
              checked={!props.hiddenOverlays.has(overlay.id)}
              onChange={() => props.onToggleOverlay(overlay.id)}
            />
          ))}
        </>
      )}
      <Divider />
      <Switch
        size="xs"
        label="Секторы"
        checked={props.showSectors}
        onChange={(e) => props.onShowSectors(e.currentTarget.checked)}
      />
      <Switch
        size="xs"
        label="Подписи (код сайта, PCI)"
        checked={props.showLabels}
        onChange={(e) => props.onShowLabels(e.currentTarget.checked)}
      />
      <div>
        <Text size="xs">Длина сектора: {props.sectorRadius} м</Text>
        <Slider
          size="xs"
          min={60}
          max={600}
          step={20}
          value={props.sectorRadius}
          onChange={props.onSectorRadius}
          label={null}
        />
      </div>
      <Divider />
      <Legend carriers={props.carriers} />
    </Stack>
  )
}

function Legend({ carriers }: { carriers: Carrier[] }) {
  return (
    <Stack gap={4}>
      <Text size="xs" fw={600}>
        Несущие
      </Text>
      {carriers.length === 0 && (
        <Text size="xs" c="dimmed">
          Нет сот
        </Text>
      )}
      {carriers.map((carrier) => (
        <Group gap={6} key={carrier.earfcn}>
          <ColorSwatch color={carrier.color} size={12} radius="xs" />
          <Text size="xs">
            EARFCN {carrier.earfcn}
            {carrier.band !== null ? ` · B${carrier.band}` : ''}
          </Text>
        </Group>
      ))}
      <Text size="xs" fw={600} mt={4}>
        Сайты
      </Text>
      <LegendRow symbol={<Dot fill={INK} />} label="в работе" />
      <LegendRow symbol={<Dot fill="#fff" />} label="планируется" />
      <LegendRow symbol={<Dot fill={MUTED} />} label="отключен, выведен" />
      <LegendRow symbol={<Dot fill={INK} ring />} label="передвижной" />
      <Text size="xs" c="dimmed">
        Пунктирный сектор: сота не в работе
      </Text>
    </Stack>
  )
}

function LegendRow({ symbol, label }: { symbol: ReactNode; label: string }) {
  return (
    <Group gap={6}>
      {symbol}
      <Text size="xs">{label}</Text>
    </Group>
  )
}

function Dot({ fill, ring = false }: { fill: string; ring?: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
      {ring && <circle cx="8" cy="8" r="7" fill="none" stroke={INK} strokeWidth="1.5" />}
      <circle
        cx="8"
        cy="8"
        r="3.5"
        fill={fill}
        stroke={fill === '#fff' ? INK : '#fff'}
        strokeWidth="1.5"
      />
    </svg>
  )
}
