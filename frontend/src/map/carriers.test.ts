import { describe, expect, it } from 'vitest'

import { assignCarrierColors, CARRIER_PALETTE, OTHER_CARRIER_COLOR } from './carriers'

describe('assignCarrierColors', () => {
  it('assigns slots by ascending EARFCN, independent of input order', () => {
    const colors = assignCarrierColors([
      { earfcn_dl: 6300, band: 20 },
      { earfcn_dl: 1300, band: 3 },
      { earfcn_dl: 1300, band: 3 },
    ])
    expect(colors.get(1300)?.color).toBe(CARRIER_PALETTE[0])
    expect(colors.get(6300)?.color).toBe(CARRIER_PALETTE[1])
    expect(colors.get(6300)?.band).toBe(20)
  })

  it('folds carriers beyond the palette into a neutral color', () => {
    const cells = Array.from({ length: 10 }, (_, i) => ({ earfcn_dl: 1200 + i, band: 3 }))
    expect(assignCarrierColors(cells).get(1209)?.color).toBe(OTHER_CARRIER_COLOR)
  })
})
