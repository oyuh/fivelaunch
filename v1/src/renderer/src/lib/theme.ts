export type Hsl = { h: number; s: number; l: number }

export const DEFAULT_PRIMARY_HEX = '#f59e0b'

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function pad2(value: number): string {
  return value.toString(16).padStart(2, '0')
}

export function isHexColor(value: string): boolean {
  return /^#([0-9a-fA-F]{6})$/.test(value.trim())
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.trim().replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return { r, g, b }
}

// https://en.wikipedia.org/wiki/HSL_and_HSV#From_RGB
export function rgbToHsl(rgb: { r: number; g: number; b: number }): Hsl {
  const r = rgb.r / 255
  const g = rgb.g / 255
  const b = rgb.b / 255

  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min

  let h = 0
  let s = 0
  const l = (max + min) / 2

  if (delta !== 0) {
    s = delta / (1 - Math.abs(2 * l - 1))

    switch (max) {
      case r:
        h = ((g - b) / delta) % 6
        break
      case g:
        h = (b - r) / delta + 2
        break
      default:
        h = (r - g) / delta + 4
        break
    }

    h *= 60
    if (h < 0) h += 360
  }

  return {
    h: Math.round(clamp(h, 0, 360)),
    s: Math.round(clamp(s * 100, 0, 100)),
    l: Math.round(clamp(l * 100, 0, 100))
  }
}

function hue2rgb(p: number, q: number, t: number): number {
  let tt = t
  if (tt < 0) tt += 1
  if (tt > 1) tt -= 1
  if (tt < 1 / 6) return p + (q - p) * 6 * tt
  if (tt < 1 / 2) return q
  if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6
  return p
}

export function hslToRgb(hsl: Hsl): { r: number; g: number; b: number } {
  const h = clamp(hsl.h, 0, 360) / 360
  const s = clamp(hsl.s, 0, 100) / 100
  const l = clamp(hsl.l, 0, 100) / 100

  if (s === 0) {
    const v = Math.round(l * 255)
    return { r: v, g: v, b: v }
  }

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q

  const r = hue2rgb(p, q, h + 1 / 3)
  const g = hue2rgb(p, q, h)
  const b = hue2rgb(p, q, h - 1 / 3)

  return {
    r: Math.round(clamp(r * 255, 0, 255)),
    g: Math.round(clamp(g * 255, 0, 255)),
    b: Math.round(clamp(b * 255, 0, 255))
  }
}

export function rgbToHex(rgb: { r: number; g: number; b: number }): string {
  const r = clamp(Math.round(rgb.r), 0, 255)
  const g = clamp(Math.round(rgb.g), 0, 255)
  const b = clamp(Math.round(rgb.b), 0, 255)
  return `#${pad2(r)}${pad2(g)}${pad2(b)}`
}

export function hslToHex(hsl: Hsl): string {
  return rgbToHex(hslToRgb(hsl))
}

export function hexToHsl(hex: string): Hsl {
  return rgbToHsl(hexToRgb(hex))
}

export function toCssHslValue(hsl: Hsl): string {
  return `${hsl.h} ${hsl.s}% ${hsl.l}%`
}

export function primaryForegroundFor(hsl: Hsl): string {
  // If the primary color is fairly bright, use a dark foreground; otherwise use a light foreground.
  // Matches the existing theme defaults (bright amber w/ dark text).
  return hsl.l >= 60 ? '20 30% 12%' : '0 0% 98%'
}

export function applyPrimaryHexToRoot(hex: string): void {
  if (!isHexColor(hex)) return

  const root = document.documentElement
  const hsl = hexToHsl(hex)

  root.style.setProperty('--primary', toCssHslValue(hsl))
  root.style.setProperty('--ring', toCssHslValue(hsl))
  root.style.setProperty('--primary-foreground', primaryForegroundFor(hsl))
}
