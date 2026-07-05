/* eslint-disable no-console */

// Generates a centered Windows .ico from the existing logo, tinted to the app primary color.
// Output: resources/Logo-Windows.ico

const path = require('path')
const fs = require('fs')
const os = require('os')
const { Jimp } = require('jimp')

const repoRoot = path.resolve(__dirname, '..')
const resourcesDir = path.join(repoRoot, 'resources')

const inputPng = path.join(resourcesDir, 'Logo.png')
const outIco = path.join(resourcesDir, 'Logo-Windows.ico')
const tempDir = path.join(os.tmpdir(), `fivelaunch-icon-build-${Date.now()}`)

// Tailwind primary in src/renderer/src/assets/index.css is: 38 92% 50% (roughly #f59e0b)
const primaryHex = (process.env.FIVELAUNCH_PRIMARY_HEX || '#f59e0b').trim()

function hexToRgb(hex) {
  const cleaned = hex.replace('#', '').trim()
  const full = cleaned.length === 3 ? cleaned.split('').map((c) => c + c).join('') : cleaned
  if (full.length !== 6) throw new Error(`Invalid hex color: ${hex}`)
  const num = parseInt(full, 16)
  return {
    r: (num >> 16) & 0xff,
    g: (num >> 8) & 0xff,
    b: num & 0xff
  }
}

function tintToColor(img, rgb) {
  img.scan(0, 0, img.bitmap.width, img.bitmap.height, function (x, y, idx) {
    const alpha = this.bitmap.data[idx + 3]
    if (alpha === 0) return
    this.bitmap.data[idx + 0] = rgb.r
    this.bitmap.data[idx + 1] = rgb.g
    this.bitmap.data[idx + 2] = rgb.b
  })
}

function trimTransparent(img) {
  const { width, height, data } = img.bitmap

  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1

  // Find bounding box of all non-transparent pixels.
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (width * y + x) * 4
      const alpha = data[idx + 3]
      if (alpha === 0) continue
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
  }

  // If image is fully transparent (shouldn't happen), return original.
  if (maxX < 0 || maxY < 0) return img

  const cropW = Math.max(1, maxX - minX + 1)
  const cropH = Math.max(1, maxY - minY + 1)
  return img.crop({ x: minX, y: minY, w: cropW, h: cropH })
}

function alphaCentroid(img) {
  const { width, height, data } = img.bitmap
  let sum = 0
  let sumX = 0
  let sumY = 0

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (width * y + x) * 4
      const a = data[idx + 3]
      if (a === 0) continue
      sum += a
      sumX += x * a
      sumY += y * a
    }
  }

  if (sum === 0) {
    return { cx: width / 2, cy: height / 2 }
  }

  return { cx: sumX / sum, cy: sumY / sum }
}

async function main() {
  if (!fs.existsSync(inputPng)) {
    throw new Error(`Missing input logo: ${inputPng}`)
  }

  fs.mkdirSync(tempDir, { recursive: true })

  const rgb = hexToRgb(primaryHex)

  const baseLogo = trimTransparent(await Jimp.read(inputPng))

  // Standard Windows icon sizes.
  const sizes = [16, 24, 32, 48, 64, 128, 256]
  const pngPaths = []

  for (const size of sizes) {
    // Provide comfortable padding so the icon doesn't look tiny.
    // Target area ~100% of the square (Windows icons typically look "fuller").
    const target = size

    const logo = baseLogo.clone()

    // Keep aspect ratio and fit into the target box.
    const ratio = Math.min(target / logo.bitmap.width, target / logo.bitmap.height)
    const newW = Math.max(1, Math.round(logo.bitmap.width * ratio))
    const newH = Math.max(1, Math.round(logo.bitmap.height * ratio))
    logo.resize({ w: newW, h: newH })

    // Tint logo pixels to the primary color.
    tintToColor(logo, rgb)

    const canvas = new Jimp({ width: size, height: size, color: 0x00000000 })
    // Optical centering: place the alpha-weighted centroid at the canvas center.
    const { cx, cy } = alphaCentroid(logo)
    const centerX = (size - 1) / 2
    const centerY = (size - 1) / 2
    let x = Math.round(centerX - cx)
    let y = Math.round(centerY - cy)

    // Clamp to keep fully visible.
    x = Math.max(0, Math.min(x, size - logo.bitmap.width))
    y = Math.max(0, Math.min(y, size - logo.bitmap.height))
    canvas.composite(logo, x, y)

    const outPng = path.join(tempDir, `win-icon-${size}.png`)
    await canvas.write(outPng)
    if (!fs.existsSync(outPng)) throw new Error(`Failed to write: ${outPng}`)
    pngPaths.push(outPng)
  }

  const { default: pngToIco } = await import('png-to-ico')
  const icoBuf = await pngToIco(pngPaths)
  fs.writeFileSync(outIco, icoBuf)
  if (!fs.existsSync(outIco)) throw new Error(`Failed to write: ${outIco}`)

  console.log(`Generated: ${path.relative(repoRoot, outIco)}`)

  try {
    fs.rmSync(tempDir, { recursive: true, force: true })
  } catch {
    // ignore
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
