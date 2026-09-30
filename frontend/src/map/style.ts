import { layers as protomapsLayers, namedFlavor } from '@protomaps/basemaps'
import type { FeatureCollection } from 'geojson'
import type {
  ExpressionSpecification,
  FilterSpecification,
  LayerSpecification,
  SourceSpecification,
  StyleSpecification,
} from 'maplibre-gl'

import type { Basemap, Overlay } from '../api/hooks'

export const INK = '#0b0b0b'
export const MUTED = '#898781'
export const SURFACE = '#f3f2ee'
const HALO = '#ffffff'
const FONT_REGULAR = ['Noto Sans Regular']
const FONT_MEDIUM = ['Noto Sans Medium']

export type Selection = { type: 'site' | 'cell'; id: number } | null

export type MapData = {
  basemap: Basemap | null
  overlays: Overlay[]
  sites: FeatureCollection
  sectors: FeatureCollection
  cellLabels: FeatureCollection
  showSectors: boolean
  showLabels: boolean
  selection: Selection
  /** Drive test: points with `seq` and `color`, the selected point and its link to the sector. */
  track?: FeatureCollection
  trackLink?: FeatureCollection
  selectedPoint?: number | null
}

// Layers that react to clicks, in priority order.
export const INTERACTIVE_LAYERS = ['track-points', 'sites-circle', 'sectors-fill'] as const

function assetUrl(path: string): string {
  return `${window.location.origin}${path}`
}

function pmtilesUrl(basemap: Basemap): string {
  return `pmtiles://${window.location.origin}${basemap.url}`
}

function basemapLayers(basemap: Basemap): {
  sources: Record<string, SourceSpecification>
  layers: LayerSpecification[]
} {
  if (basemap.kind === 'raster') {
    return {
      sources: {
        basemap: {
          type: 'raster',
          url: pmtilesUrl(basemap),
          tileSize: 256,
          attribution: basemap.attribution ?? undefined,
        },
      },
      layers: [{ id: 'basemap-raster', type: 'raster', source: 'basemap' }],
    }
  }
  const sources: Record<string, SourceSpecification> = {
    basemap: {
      type: 'vector',
      url: pmtilesUrl(basemap),
      attribution: basemap.attribution ?? undefined,
    },
  }
  if (basemap.schema_name === 'protomaps') {
    return { sources, layers: protomapsLayers('basemap', namedFlavor('light'), { lang: 'ru' }) }
  }
  // Unknown vector schema: draw every layer as neutral outlines, better than nothing.
  const layers: LayerSpecification[] = basemap.vector_layers.flatMap((layer) => [
    {
      id: `basemap-${layer}-fill`,
      type: 'fill',
      source: 'basemap',
      'source-layer': layer,
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: { 'fill-color': '#e4e2da', 'fill-opacity': 0.5 },
    },
    {
      id: `basemap-${layer}-line`,
      type: 'line',
      source: 'basemap',
      'source-layer': layer,
      paint: { 'line-color': '#c3c2b7', 'line-width': 0.8 },
    },
  ])
  return { sources, layers }
}

function overlayLayers(overlay: Overlay): LayerSpecification[] {
  const source = `overlay-${overlay.id}`
  return [
    {
      id: `${source}-fill`,
      type: 'fill',
      source,
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: { 'fill-color': overlay.color, 'fill-opacity': 0.12 },
    },
    {
      id: `${source}-line`,
      type: 'line',
      source,
      filter: ['!=', ['geometry-type'], 'Point'],
      paint: { 'line-color': overlay.color, 'line-width': 1.5 },
    },
    {
      id: `${source}-point`,
      type: 'circle',
      source,
      filter: ['==', ['geometry-type'], 'Point'],
      paint: { 'circle-color': overlay.color, 'circle-radius': 4 },
    },
  ]
}

function selectionFilter(selection: Selection, siteKey: string): FilterSpecification {
  if (selection === null) return ['==', ['get', siteKey], -1]
  if (selection.type === 'cell') return ['==', ['get', 'cellId'], selection.id]
  return ['==', ['get', siteKey], selection.id]
}

const inactive: ExpressionSpecification = [
  'in',
  ['get', 'status'],
  ['literal', ['inactive', 'dismantled']],
]

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] }

function trackLayers(data: MapData): LayerSpecification[] {
  if (!data.track) return []
  return [
    {
      // From the selected point to the antenna of its serving cell.
      id: 'track-link',
      type: 'line',
      source: 'track-link',
      paint: { 'line-color': INK, 'line-width': 1.5 },
    },
    {
      id: 'track-points',
      type: 'circle',
      source: 'track',
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 2.5, 16, 5],
        'circle-color': ['get', 'color'],
        'circle-stroke-color': HALO,
        'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 12, 0, 15, 1],
      },
    },
    {
      id: 'track-selected',
      type: 'circle',
      source: 'track',
      filter: ['==', ['get', 'seq'], data.selectedPoint ?? -1],
      paint: {
        'circle-radius': 8,
        'circle-color': 'rgba(0,0,0,0)',
        'circle-stroke-color': INK,
        'circle-stroke-width': 2.5,
      },
    },
  ]
}

export function buildStyle(data: MapData): StyleSpecification {
  const sources: Record<string, SourceSpecification> = {
    sites: { type: 'geojson', data: data.sites },
    sectors: { type: 'geojson', data: data.sectors },
    'cell-labels': { type: 'geojson', data: data.cellLabels },
  }
  if (data.track) {
    sources.track = { type: 'geojson', data: data.track }
    sources['track-link'] = { type: 'geojson', data: data.trackLink ?? EMPTY }
  }
  const layers: LayerSpecification[] = [
    { id: 'background', type: 'background', paint: { 'background-color': SURFACE } },
  ]

  if (data.basemap) {
    const base = basemapLayers(data.basemap)
    Object.assign(sources, base.sources)
    layers.push(...base.layers)
  }

  for (const overlay of data.overlays) {
    sources[`overlay-${overlay.id}`] = {
      type: 'geojson',
      data: overlay.geojson as unknown as FeatureCollection,
    }
    layers.push(...overlayLayers(overlay))
  }

  const sectorsVisibility = data.showSectors ? 'visible' : 'none'
  const labelsVisibility = data.showLabels ? 'visible' : 'none'
  layers.push(
    {
      id: 'sectors-fill',
      type: 'fill',
      source: 'sectors',
      layout: { visibility: sectorsVisibility },
      paint: {
        'fill-color': ['get', 'color'],
        'fill-opacity': ['case', ['==', ['get', 'status'], 'active'], 0.38, 0.12],
      },
    },
    {
      id: 'sectors-line',
      type: 'line',
      source: 'sectors',
      layout: { visibility: sectorsVisibility },
      filter: ['==', ['get', 'status'], 'active'],
      paint: { 'line-color': ['get', 'color'], 'line-width': 1.2 },
    },
    {
      // Planned / inactive cells: dashed outline, so status never relies on color alone.
      id: 'sectors-line-dashed',
      type: 'line',
      source: 'sectors',
      layout: { visibility: sectorsVisibility },
      filter: ['!=', ['get', 'status'], 'active'],
      paint: { 'line-color': ['get', 'color'], 'line-width': 1.2, 'line-dasharray': [2, 2] },
    },
    {
      id: 'sectors-selected',
      type: 'line',
      source: 'sectors',
      layout: { visibility: sectorsVisibility },
      filter: selectionFilter(data.selection, 'siteId'),
      paint: { 'line-color': INK, 'line-width': 2.5 },
    },
    ...trackLayers(data),
    {
      id: 'cell-labels',
      type: 'symbol',
      source: 'cell-labels',
      minzoom: 14.5,
      layout: {
        visibility: data.showSectors ? labelsVisibility : 'none',
        'text-field': ['get', 'label'],
        'text-font': FONT_REGULAR,
        'text-size': 11,
      },
      paint: { 'text-color': INK, 'text-halo-color': HALO, 'text-halo-width': 1.5 },
    },
    {
      // KPI mode at network zoom: sectors are too small, the site shows its worst cell.
      id: 'sites-kpi',
      type: 'circle',
      source: 'sites',
      maxzoom: 14,
      filter: ['has', 'kpiColor'],
      paint: {
        'circle-radius': ['get', 'kpiRadius'],
        'circle-color': ['get', 'kpiColor'],
        'circle-stroke-color': HALO,
        'circle-stroke-width': 1.5,
      },
    },
    {
      // Mobile sites get an outer ring: shape, not color, carries the site kind.
      id: 'sites-mobile-ring',
      type: 'circle',
      source: 'sites',
      filter: ['==', ['get', 'kind'], 'mobile'],
      paint: {
        // Outside the KPI mark when there is one.
        'circle-radius': ['case', ['has', 'kpiColor'], ['+', ['get', 'kpiRadius'], 3], 9],
        'circle-color': 'rgba(0,0,0,0)',
        'circle-stroke-color': INK,
        'circle-stroke-width': 1.5,
      },
    },
    {
      id: 'sites-circle',
      type: 'circle',
      source: 'sites',
      paint: {
        'circle-radius': 5,
        // Planned sites are hollow; inactive ones are muted.
        'circle-color': ['case', ['==', ['get', 'status'], 'planned'], HALO, inactive, MUTED, INK],
        'circle-stroke-color': ['case', ['==', ['get', 'status'], 'planned'], INK, HALO],
        'circle-stroke-width': 2,
      },
    },
    {
      id: 'sites-selected',
      type: 'circle',
      source: 'sites',
      filter: selectionFilter(data.selection?.type === 'site' ? data.selection : null, 'siteId'),
      paint: {
        'circle-radius': 12,
        'circle-color': 'rgba(0,0,0,0)',
        'circle-stroke-color': INK,
        'circle-stroke-width': 2.5,
      },
    },
    {
      id: 'sites-label',
      type: 'symbol',
      source: 'sites',
      minzoom: 11,
      layout: {
        visibility: labelsVisibility,
        'text-field': ['get', 'code'],
        'text-font': FONT_MEDIUM,
        'text-size': 12,
        'text-offset': [0, 1.1],
        'text-anchor': 'top',
      },
      paint: { 'text-color': INK, 'text-halo-color': HALO, 'text-halo-width': 1.5 },
    },
  )

  return {
    version: 8,
    glyphs: assetUrl('/map-assets/fonts/{fontstack}/{range}.pbf'),
    sprite: assetUrl('/map-assets/sprites/light'),
    sources,
    layers,
  }
}
