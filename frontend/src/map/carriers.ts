/**
 * Carrier (EARFCN) colors: validated categorical palette in fixed slot order.
 * Colors follow the carrier, not its rank in the current view: slots are assigned
 * by ascending EARFCN over the whole network.
 */
export const CARRIER_PALETTE = [
  '#2a78d6',
  '#eb6834',
  '#1baf7a',
  '#eda100',
  '#e87ba4',
  '#008300',
  '#4a3aa7',
  '#e34948',
] as const

export const OTHER_CARRIER_COLOR = '#898781'

export type Carrier = { earfcn: number; band: number | null; color: string }

export function assignCarrierColors(
  cells: { earfcn_dl: number; band: number | null }[],
): Map<number, Carrier> {
  const bands = new Map<number, number | null>()
  for (const cell of cells) bands.set(cell.earfcn_dl, cell.band)
  const earfcns = [...bands.keys()].sort((a, b) => a - b)
  return new Map(
    earfcns.map((earfcn, i) => [
      earfcn,
      { earfcn, band: bands.get(earfcn) ?? null, color: CARRIER_PALETTE[i] ?? OTHER_CARRIER_COLOR },
    ]),
  )
}
