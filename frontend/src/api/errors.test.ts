import { describe, expect, it } from 'vitest'

import { errorMessage } from './errors'

describe('errorMessage', () => {
  it('uses a plain detail', () => {
    expect(errorMessage({ detail: 'Сайт не найден' }, 404)).toBe('Сайт не найден')
  })

  it('formats validation errors', () => {
    const body = {
      detail: [
        { loc: ['body', 'pci'], msg: 'Input should be less than or equal to 503' },
        { loc: ['body'], msg: 'Value error, Ожидается GeoJSON FeatureCollection' },
      ],
    }
    expect(errorMessage(body, 422)).toBe(
      'pci: Input should be less than or equal to 503; Ожидается GeoJSON FeatureCollection',
    )
  })

  it('falls back to the status', () => {
    expect(errorMessage(undefined, 502)).toBe('Ошибка сервера (502)')
  })
})
