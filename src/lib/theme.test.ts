import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PRIMARY_HEX,
  hexToHsl,
  hslToHex,
  isHexColor,
  primaryForegroundFor,
  toCssHslValue
} from './theme'

describe('isHexColor (matches v1 + Rust core is_hex_color)', () => {
  it('accepts #rrggbb with surrounding whitespace', () => {
    expect(isHexColor('#f59e0b')).toBe(true)
    expect(isHexColor('  #F59E0B  ')).toBe(true)
  })

  it('rejects everything else', () => {
    expect(isHexColor('#f59')).toBe(false)
    expect(isHexColor('f59e0b')).toBe(false)
    expect(isHexColor('#f59e0g')).toBe(false)
    expect(isHexColor('#f59e0b0')).toBe(false)
    expect(isHexColor('')).toBe(false)
  })
})

describe('hex <-> hsl round trip', () => {
  it('default primary matches the v1 CSS variable', () => {
    // v1 :root has --primary: 38 92% 50%, DEFAULT_PRIMARY_HEX #f59e0b
    const hsl = hexToHsl(DEFAULT_PRIMARY_HEX)
    expect(toCssHslValue(hsl)).toBe('38 92% 50%')
  })

  it('round trips common colors within rounding error', () => {
    for (const hex of ['#f59e0b', '#ff0000', '#00ff00', '#0000ff', '#123456', '#ffffff', '#000000']) {
      const back = hslToHex(hexToHsl(hex))
      const dist = Math.abs(parseInt(back.slice(1), 16) - parseInt(hex.slice(1), 16))
      // Rounding through integer HSL can drift slightly; must stay very close.
      expect(dist).toBeLessThan(0x030303)
    }
  })
})

describe('primaryForegroundFor', () => {
  it('bright colors get dark foreground', () => {
    expect(primaryForegroundFor({ h: 38, s: 92, l: 70 })).toBe('20 30% 12%')
  })

  it('dark colors get light foreground', () => {
    expect(primaryForegroundFor({ h: 38, s: 92, l: 30 })).toBe('0 0% 98%')
  })
})
