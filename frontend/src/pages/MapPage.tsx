import { Box, Paper, Stack } from '@mantine/core'
import { useLocalStorage } from '@mantine/hooks'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'

import { type SearchHit, useBasemaps, useMapInventory, useOverlays } from '../api/hooks'
import { assignCarrierColors } from '../map/carriers'
import { cellLabelFeatures, sectorFeatures, siteFeatures } from '../map/features'
import { boundsOf, type LonLat } from '../map/geo'
import { LayersPanel } from '../map/LayersPanel'
import { type FlyTarget, type InitialView, MapView } from '../map/MapView'
import { ObjectPanel } from '../map/ObjectPanel'
import { SearchBox } from '../map/SearchBox'
import { buildStyle, type Selection } from '../map/style'

const PANEL_WIDTH = 408

// Keeps centered objects clear of the search box and the object panel.
function paddingFor(panelOpen: boolean) {
  return { top: 60, bottom: 20, left: 20, right: panelOpen ? PANEL_WIDTH + 24 : 20 }
}

function parseSelection(params: URLSearchParams): Selection {
  const site = Number(params.get('site'))
  if (site) return { type: 'site', id: site }
  const cell = Number(params.get('cell'))
  if (cell) return { type: 'cell', id: cell }
  return null
}

export function MapPage() {
  const inventory = useMapInventory()
  const overlays = useOverlays()
  const basemaps = useBasemaps()
  const [params, setParams] = useSearchParams()
  const selection = parseSelection(params)

  // Per-viewer display preferences survive page reloads.
  const [basemapId, setBasemapId] = useLocalStorage<string | null>({
    key: 'map.basemap',
    defaultValue: null,
  })
  // The viewer's own overlay toggles; overlays never toggled follow their visible_by_default.
  const [overlayToggles, setOverlayToggles] = useLocalStorage<Record<string, boolean>>({
    key: 'map.overlayVisibility',
    defaultValue: {},
  })
  const [showSectors, setShowSectors] = useLocalStorage({ key: 'map.sectors', defaultValue: true })
  const [showLabels, setShowLabels] = useLocalStorage({ key: 'map.labels', defaultValue: true })
  const [sectorRadius, setSectorRadius] = useLocalStorage({
    key: 'map.sectorRadius',
    defaultValue: 180,
  })
  const [flyTo, setFlyTo] = useState<FlyTarget | null>(null)

  const sites = useMemo(() => inventory.data ?? [], [inventory.data])
  const carriers = useMemo(() => assignCarrierColors(sites.flatMap((s) => s.cells)), [sites])
  const basemap = basemaps.data?.find((b) => b.id === basemapId) ?? null
  const hiddenSet = useMemo(
    () =>
      new Set(
        (overlays.data ?? [])
          .filter((o) => !(overlayToggles[o.id] ?? o.visible_by_default))
          .map((o) => o.id),
      ),
    [overlays.data, overlayToggles],
  )
  const visibleOverlays = useMemo(
    () => (overlays.data ?? []).filter((o) => !hiddenSet.has(o.id)),
    [overlays.data, hiddenSet],
  )

  const style = useMemo(
    () =>
      buildStyle({
        basemap,
        overlays: visibleOverlays,
        sites: siteFeatures(sites),
        sectors: sectorFeatures(sites, carriers, sectorRadius),
        cellLabels: cellLabelFeatures(sites, sectorRadius),
        showSectors,
        showLabels,
        selection,
      }),
    // selection is derived from the URL on every render: compare by value
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      basemap,
      visibleOverlays,
      sites,
      carriers,
      sectorRadius,
      showSectors,
      showLabels,
      selection?.type,
      selection?.id,
    ],
  )

  // Opened with ?site= or ?cell= (from a table): start on that object, otherwise show the network.
  const initialView = useMemo<InitialView | null>(() => {
    if (!inventory.data || basemaps.isPending) return null
    if (selection) {
      const site = sites.find((s) =>
        selection.type === 'site'
          ? s.id === selection.id
          : s.cells.some((c) => c.id === selection.id),
      )
      if (site) return { lon: site.lon, lat: site.lat, zoom: 15 }
    }
    const bounds = boundsOf(sites.map((s): LonLat => [s.lon, s.lat])) ?? basemap?.bounds ?? null
    return bounds ? { bounds } : null
    // Computed for the first render with data only; later selections do not move the map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inventory.data, basemaps.isPending])

  const panelOpen = selection !== null
  const padding = useMemo(() => paddingFor(panelOpen), [panelOpen])

  const select = (next: Selection) => {
    const nextParams = new URLSearchParams()
    if (next) nextParams.set(next.type, String(next.id))
    setParams(nextParams, { replace: true })
  }

  const onPick = (hit: SearchHit) => {
    const target: Selection =
      hit.type === 'site' || hit.type === 'cell' ? { type: hit.type, id: hit.id } : null
    const opensPanel = target !== null
    if (hit.lat != null && hit.lon != null) {
      // The URL (and so the panel) updates asynchronously: pass the future padding explicitly.
      setFlyTo({ lon: hit.lon, lat: hit.lat, key: Date.now(), padding: paddingFor(opensPanel) })
    }
    if (target) select(target)
  }

  return (
    <Box pos="relative" h="100%">
      <MapView
        style={style}
        initialView={initialView}
        flyTo={flyTo}
        padding={padding}
        onSelect={select}
      />
      <Stack pos="absolute" top={12} left={12} w={320} gap="xs" style={{ zIndex: 2 }}>
        <SearchBox onPick={onPick} />
      </Stack>
      <Paper
        pos="absolute"
        top={12}
        right={selection ? PANEL_WIDTH + 24 : 12}
        w={240}
        p="sm"
        shadow="sm"
        withBorder
        style={{ zIndex: 2 }}
      >
        <LayersPanel
          basemaps={basemaps.data ?? []}
          basemapId={basemap?.id ?? null}
          onBasemap={setBasemapId}
          overlays={overlays.data ?? []}
          hiddenOverlays={hiddenSet}
          onToggleOverlay={(id) =>
            setOverlayToggles({ ...overlayToggles, [id]: hiddenSet.has(id) })
          }
          showSectors={showSectors}
          onShowSectors={setShowSectors}
          showLabels={showLabels}
          onShowLabels={setShowLabels}
          sectorRadius={sectorRadius}
          onSectorRadius={setSectorRadius}
          carriers={[...carriers.values()]}
        />
      </Paper>
      {selection && (
        <Paper
          pos="absolute"
          top={12}
          right={12}
          bottom={12}
          w={PANEL_WIDTH}
          p="md"
          shadow="md"
          withBorder
          style={{ zIndex: 3, display: 'flex', flexDirection: 'column' }}
        >
          <ObjectPanel selection={selection} onSelect={select} />
        </Paper>
      )}
    </Box>
  )
}
