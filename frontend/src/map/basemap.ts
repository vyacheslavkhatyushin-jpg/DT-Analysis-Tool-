import { useLocalStorage } from '@mantine/hooks'

import { useBasemaps } from '../api/hooks'

/** The viewer's basemap, one choice for every map in the app (kept across reloads). */
export function useBasemapChoice() {
  const basemaps = useBasemaps()
  const [basemapId, setBasemapId] = useLocalStorage<string | null>({
    key: 'map.basemap',
    defaultValue: null,
  })
  return {
    basemaps: basemaps.data ?? [],
    basemap: basemaps.data?.find((b) => b.id === basemapId) ?? null,
    isPending: basemaps.isPending,
    setBasemapId,
  }
}
