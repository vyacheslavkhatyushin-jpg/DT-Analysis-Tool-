import 'maplibre-gl/dist/maplibre-gl.css'

import {
  addProtocol,
  type LngLatBoundsLike,
  Map as MapLibreMap,
  type MapMouseEvent,
  NavigationControl,
  ScaleControl,
  setWorkerUrl,
  type StyleSpecification,
} from 'maplibre-gl'
// MapLibre 6 locates its worker relative to its own module URL, which bundlers rewrite.
// Let Vite bundle the worker and hand MapLibre the resulting URL instead.
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { Protocol } from 'pmtiles'
import { useEffect, useRef } from 'react'

import { type Bounds } from './geo'
import { INTERACTIVE_LAYERS, type Selection } from './style'

// The worker URL and the PMTiles protocol are set up once per page.
let protocolRegistered = false
function registerPmtiles() {
  if (protocolRegistered) return
  setWorkerUrl(maplibreWorkerUrl)
  const protocol = new Protocol()
  addProtocol('pmtiles', protocol.tile)
  protocolRegistered = true
}

export type FlyTarget = { lon: number; lat: number; zoom?: number; key: number }
export type InitialView = { bounds: Bounds } | { lon: number; lat: number; zoom: number }

type Props = {
  style: StyleSpecification
  /** Applied once, as soon as it is known. */
  initialView: InitialView | null
  flyTo: FlyTarget | null
  /** Space covered by floating panels, kept clear when centering. */
  padding: { top: number; right: number; bottom: number; left: number }
  onSelect: (selection: Selection) => void
}

export function MapView({ style, initialView, flyTo, padding, onSelect }: Props) {
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const onSelectRef = useRef(onSelect)
  useEffect(() => {
    onSelectRef.current = onSelect
  })
  const fittedRef = useRef(false)

  useEffect(() => {
    if (!container.current) return
    registerPmtiles()
    const map = new MapLibreMap({
      container: container.current,
      style,
      center: [87.25, 54.05],
      zoom: 12,
      attributionControl: { compact: true },
    })
    map.addControl(new NavigationControl({ visualizePitch: false }), 'bottom-right')
    map.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-left')

    map.on('click', (event: MapMouseEvent) => {
      const layers = INTERACTIVE_LAYERS.filter((id) => map.getLayer(id))
      const [feature] = map.queryRenderedFeatures(event.point, { layers })
      if (!feature) {
        onSelectRef.current(null)
        return
      }
      const props = feature.properties as { siteId?: number; cellId?: number }
      if (feature.layer.id === 'sites-circle' && props.siteId !== undefined) {
        onSelectRef.current({ type: 'site', id: props.siteId })
      } else if (props.cellId !== undefined) {
        onSelectRef.current({ type: 'cell', id: props.cellId })
      }
    })
    for (const layer of INTERACTIVE_LAYERS) {
      map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'))
      map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''))
    }

    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
    }
    // The map is created once; later style changes are applied as diffs below.
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    mapRef.current?.setStyle(style, { diff: true })
  }, [style])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !initialView || fittedRef.current) return
    fittedRef.current = true
    if ('bounds' in initialView) {
      const [west, south, east, north] = initialView.bounds
      const bounds: LngLatBoundsLike = [
        [west, south],
        [east, north],
      ]
      map.fitBounds(bounds, { padding: 80, maxZoom: 15, duration: 0 })
    } else {
      map.jumpTo({ center: [initialView.lon, initialView.lat], zoom: initialView.zoom, padding })
    }
  }, [initialView, padding])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !flyTo) return
    map.flyTo({
      center: [flyTo.lon, flyTo.lat],
      zoom: Math.max(map.getZoom(), flyTo.zoom ?? 15),
      padding,
    })
    // Only a new target should move the map, not a padding change.
  }, [flyTo]) // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={container} style={{ position: 'absolute', inset: 0 }} />
}
