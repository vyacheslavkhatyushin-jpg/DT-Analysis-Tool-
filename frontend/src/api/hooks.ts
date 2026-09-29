import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api, type Schemas, unwrap } from './client'

export type Site = Schemas['SiteRead']
export type ENodeB = Schemas['ENodeBRead']
export type Cell = Schemas['CellRead']
export type CellVersion = Schemas['CellVersionRead']
export type SitePosition = Schemas['SitePositionRead']
export type Asset = Schemas['AssetRead']
export type Device = Schemas['DeviceRead']
export type Change = Schemas['ChangeRead']
export type MapSite = Schemas['MapSite']
export type MapCell = Schemas['MapCell']
export type Basemap = Schemas['Basemap']
export type Overlay = Schemas['MapOverlayRead']
export type User = Schemas['UserRead']
export type SearchHit = Schemas['SearchHit']
export type ImportReport = Schemas['ImportReport']
export type KpiDef = Schemas['KpiDefRead']
export type KpiSummary = Schemas['KpiSummaryRead']
export type KpiCellStats = Schemas['KpiCellStatsRead']
export type KpiStat = Schemas['KpiStatRead']
export type KpiLevel = NonNullable<KpiStat['level']>
export type KpiImport = Schemas['KpiImportRead']
export type KpiSeries = Schemas['KpiSeriesRead']
export type KpiReconciliation = Schemas['ReconciliationRead']
export type KpiPeriod = { start: string; end: string }

// Every inventory query lives under this prefix: any edit refreshes all of them.
// The inventory is small (tens of sites), so precise invalidation is not worth the complexity.
const INVENTORY = 'inventory'

export const useSites = () =>
  useQuery({
    queryKey: [INVENTORY, 'sites'],
    queryFn: () => unwrap(api.GET('/api/v1/sites')),
  })

export const useSitePositions = (siteId: number | null) =>
  useQuery({
    queryKey: [INVENTORY, 'site-positions', siteId],
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/sites/{site_id}/positions', { params: { path: { site_id: siteId! } } }),
      ),
    enabled: siteId !== null,
  })

export const useENodeBs = () =>
  useQuery({
    queryKey: [INVENTORY, 'enodebs'],
    queryFn: () => unwrap(api.GET('/api/v1/enodebs')),
  })

export const useCells = () =>
  useQuery({
    queryKey: [INVENTORY, 'cells'],
    queryFn: () => unwrap(api.GET('/api/v1/cells')),
  })

export const useCellVersions = (cellId: number | null) =>
  useQuery({
    queryKey: [INVENTORY, 'cell-versions', cellId],
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/cells/{cell_id}/versions', { params: { path: { cell_id: cellId! } } }),
      ),
    enabled: cellId !== null,
  })

export const useAssets = () =>
  useQuery({
    queryKey: [INVENTORY, 'assets'],
    queryFn: () => unwrap(api.GET('/api/v1/assets')),
  })

export const useDevices = () =>
  useQuery({
    queryKey: [INVENTORY, 'devices'],
    queryFn: () => unwrap(api.GET('/api/v1/devices')),
  })

export const useChanges = (params: { entity_type?: string; entity_id?: number; limit?: number }) =>
  useQuery({
    queryKey: [INVENTORY, 'changes', params],
    queryFn: () => unwrap(api.GET('/api/v1/changes', { params: { query: params } })),
  })

export const useMapInventory = () =>
  useQuery({
    queryKey: [INVENTORY, 'map'],
    queryFn: () => unwrap(api.GET('/api/v1/map/inventory')),
  })

export const useOverlays = () =>
  useQuery({
    queryKey: [INVENTORY, 'overlays'],
    queryFn: () => unwrap(api.GET('/api/v1/map/overlays')),
  })

export const useBasemaps = () =>
  useQuery({
    queryKey: ['basemaps'],
    // Tuples (bounds, center) are widened to arrays by the fetch client's response typing.
    queryFn: async () => (await unwrap(api.GET('/api/v1/map/basemaps'))) as Basemap[],
    staleTime: 5 * 60_000,
  })

export const useUsers = () =>
  useQuery({
    queryKey: ['users'],
    queryFn: () => unwrap(api.GET('/api/v1/users')),
  })

export const useSearch = (q: string) =>
  useQuery({
    queryKey: ['search', q],
    queryFn: () => unwrap(api.GET('/api/v1/search', { params: { query: { q } } })),
    enabled: q.trim().length > 0,
    staleTime: 10_000,
  })

export const useKpiCatalogue = () =>
  useQuery({
    queryKey: ['kpi-catalogue'],
    queryFn: () => unwrap(api.GET('/api/v1/kpi/catalogue')),
    staleTime: Infinity,
  })

// Statistics are linked to inventory cells by name: they live under the inventory prefix,
// so renaming or linking a cell refreshes them too.
export const useKpiSummary = (period: KpiPeriod | null, enabled = true) =>
  useQuery({
    queryKey: [INVENTORY, 'kpi', 'summary', period],
    queryFn: () => unwrap(api.GET('/api/v1/kpi/summary', { params: { query: period ?? {} } })),
    placeholderData: keepPreviousData,
    enabled,
  })

export const useKpiSeries = (cellId: number, period: KpiPeriod | null) =>
  useQuery({
    queryKey: [INVENTORY, 'kpi', 'series', cellId, period],
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/cells/{cell_id}/kpi', {
          params: { path: { cell_id: cellId }, query: period ?? {} },
        }),
      ),
    placeholderData: keepPreviousData,
  })

export const useKpiReconciliation = () =>
  useQuery({
    queryKey: [INVENTORY, 'kpi', 'reconciliation'],
    queryFn: () => unwrap(api.GET('/api/v1/kpi/reconciliation')),
  })

export const useKpiFiles = () =>
  useQuery({
    queryKey: [INVENTORY, 'kpi', 'files'],
    queryFn: () => unwrap(api.GET('/api/v1/kpi/files')),
  })

/** Mutation that refreshes all inventory queries on success. */
export function useInventoryMutation<TVars, TResult>(fn: (vars: TVars) => Promise<TResult>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [INVENTORY] }),
  })
}

export function useInvalidateInventory() {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: [INVENTORY] })
}
