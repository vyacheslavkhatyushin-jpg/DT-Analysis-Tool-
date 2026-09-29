import { describe, expect, it } from 'vitest'

import { formatValue, plural } from './labels'

describe('plural', () => {
  it('picks the Russian form', () => {
    expect(plural(1, 'поле', 'поля', 'полей')).toBe('1 поле')
    expect(plural(3, 'поле', 'поля', 'полей')).toBe('3 поля')
    expect(plural(6, 'поле', 'поля', 'полей')).toBe('6 полей')
    expect(plural(21, 'поле', 'поля', 'полей')).toBe('21 поле')
  })
})

describe('formatValue', () => {
  it('translates enums and empties', () => {
    expect(formatValue('planned')).toBe('планируется')
    expect(formatValue(null)).toBe('—')
    expect(formatValue(true)).toBe('да')
    expect(formatValue(12.5)).toBe('12.5')
  })
})
