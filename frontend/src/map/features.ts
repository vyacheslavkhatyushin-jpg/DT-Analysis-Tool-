import type { Feature, FeatureCollection, Point, Polygon } from 'geojson'

import type { MapCell, MapSite } from '../api/hooks'
import { circleRing, destination, type LonLat, sectorRing } from './geo'

const DEFAULT_BEAMWIDTH = 65

export type SiteProps = {
  siteId: number
  code: string
  name: string
  kind: string
  status: string
  // KPI mode: the worst state among the site's cells, shown when sectors are too small to see.
  kpiColor?: string
  kpiRadius?: number
}
export type SiteMark = { color: string; radius: number }
export type SectorProps = {
  cellId: number
  siteId: number
  name: string
  pci: number
  earfcn: number
  color: string
  status: string
}
export type CellLabelProps = { cellId: number; label: string }

export function siteFeatures(
  sites: MapSite[],
  markFor?: (site: MapSite) => SiteMark | null,
): FeatureCollection<Point, SiteProps> {
  return {
    type: 'FeatureCollection',
    features: sites.map((site) => {
      const mark = markFor?.(site)
      return {
        type: 'Feature',
        id: site.id,
        geometry: { type: 'Point', coordinates: [site.lon, site.lat] },
        properties: {
          siteId: site.id,
          code: site.code,
          name: site.name ?? '',
          kind: site.kind,
          status: site.status,
          ...(mark ? { kpiColor: mark.color, kpiRadius: mark.radius } : {}),
        },
      }
    }),
  }
}

export function sectorFeatures(
  sites: MapSite[],
  colorFor: (cell: MapCell) => string,
  radiusM: number,
): FeatureCollection<Polygon, SectorProps> {
  const features: Feature<Polygon, SectorProps>[] = []
  for (const site of sites) {
    const center: LonLat = [site.lon, site.lat]
    // Several carriers on one azimuth: the higher layer is drawn slightly shorter to stay visible.
    const layerIndex = new Map<string, number>()
    for (const cell of site.cells) {
      const key = String(cell.azimuth_deg)
      const index = layerIndex.get(key) ?? 0
      layerIndex.set(key, index + 1)
      const radius = radiusM * (1 - 0.18 * index)
      const ring =
        cell.azimuth_deg === null
          ? circleRing(center, radius * 0.4)
          : sectorRing(center, cell.azimuth_deg, cell.beamwidth_deg ?? DEFAULT_BEAMWIDTH, radius)
      features.push({
        type: 'Feature',
        id: cell.id,
        geometry: { type: 'Polygon', coordinates: [ring] },
        properties: {
          cellId: cell.id,
          siteId: site.id,
          name: cell.name ?? `ECI ${cell.eci}`,
          pci: cell.pci,
          earfcn: cell.earfcn_dl,
          color: colorFor(cell),
          status: cell.status,
        },
      })
    }
  }
  return { type: 'FeatureCollection', features }
}

export function cellLabelFeatures(
  sites: MapSite[],
  radiusM: number,
  labelFor: (cell: MapCell) => string = (cell) => String(cell.pci),
): FeatureCollection<Point, CellLabelProps> {
  const features: Feature<Point, CellLabelProps>[] = []
  for (const site of sites) {
    for (const cell of site.cells) {
      if (cell.azimuth_deg === null) continue
      features.push({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: destination([site.lon, site.lat], cell.azimuth_deg, radiusM * 0.72),
        },
        properties: { cellId: cell.id, label: labelFor(cell) },
      })
    }
  }
  return { type: 'FeatureCollection', features }
}
