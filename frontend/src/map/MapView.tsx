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

export type Padding = { top: number; right: number; bottom: number; left: number }
/** `padding` overrides the current one, e.g. for a panel that opens together with the fly-to. */
export type FlyTarget = { lon: number; lat: number; zoom?: number; key: number; padding?: Padding }
export type InitialView = { bounds: Bounds } | { lon: number; lat: number; zoom: number }

type Props = {
  style: StyleSpecification
  /** Applied once, as soon as it is known. */
  initialView: InitialView | null
  flyTo: FlyTarget | null
  /** Space covered by floating panels, kept clear when centering. */
  padding: Padding
  onSelect: (selection: Selection) => void
  /** Click on a drive test point (its `seq`). */
  onPoint?: (seq: number) => void
}

export function MapView({ style, initialView, flyTo, padding, onSelect, onPoint }: Props) {
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const onSelectRef = useRef(onSelect)
  const onPointRef = useRef(onPoint)
  useEffect(() => {
    onSelectRef.current = onSelect
    onPointRef.current = onPoint
  })
  const fittedRef = useRef(false)
  const loadedRef = useRef(false)
  const styleRef = useRef(style)

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
      const props = feature.properties as { siteId?: number; cellId?: number; seq?: number }
      if (feature.layer.id === 'track-points' && props.seq !== undefined) {
        onPointRef.current?.(props.seq)
      } else if (feature.layer.id === 'sites-circle' && props.siteId !== undefined) {
        onSelectRef.current({ type: 'site', id: props.siteId })
      } else if (props.cellId !== undefined) {
        onSelectRef.current({ type: 'cell', id: props.cellId })
      }
    })
    for (const layer of INTERACTIVE_LAYERS) {
      map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'))
      map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''))
    }

    map.once('load', () => {
      loadedRef.current = true
      map.setStyle(styleRef.current, { diff: true })
    })

    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
      // A new map (React re-runs effects in development) needs its own initial fit.
      fittedRef.current = false
      loadedRef.current = false
    }
    // The map is created once; later style changes are applied as diffs below.
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Style changes are applied as diffs once the initial style has loaded;
  // changes that arrive earlier are picked up by the 'load' handler.
  useEffect(() => {
    styleRef.current = style
    const map = mapRef.current
    if (map?.isStyleLoaded()) map.setStyle(style, { diff: true })
  }, [style])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !initialView || fittedRef.current) return
    fittedRef.current = true
    // A map created together with its data may not have its final size yet: fit once it has.
    const fit = () => {
      map.resize()
      fitView(map, initialView, padding)
    }
    if (loadedRef.current) fit()
    else map.once('load', fit)
  }, [initialView, padding])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !flyTo) return
    map.flyTo({
      center: [flyTo.lon, flyTo.lat],
      zoom: Math.max(map.getZoom(), flyTo.zoom ?? 15),
      padding: flyTo.padding ?? padding,
    })
    // Only a new target should move the map, not a padding change.
  }, [flyTo]) // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={container} style={{ position: 'absolute', inset: 0 }} />
}

function fitView(map: MapLibreMap, view: InitialView, padding: Padding) {
  if ('bounds' in view) {
    const [west, south, east, north] = view.bounds
    const bounds: LngLatBoundsLike = [
      [west, south],
      [east, north],
    ]
    // Clear of the panels (padding) plus some air around the outermost sites.
    const air = 40
    map.fitBounds(bounds, {
      padding: {
        top: padding.top + air,
        bottom: padding.bottom + air,
        left: padding.left + air,
        right: padding.right + air,
      },
      maxZoom: 15,
      duration: 0,
    })
  } else {
    map.jumpTo({ center: [view.lon, view.lat], zoom: view.zoom, padding })
  }
}
