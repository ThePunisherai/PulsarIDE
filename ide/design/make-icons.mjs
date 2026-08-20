/**
 * Turn assets/icon.svg into the app icons electron-builder packages.
 *
 *   node ide/design/make-icons.mjs
 *
 * Writes the five icons the overlay copies over Orca's own:
 *   resources/build/{icon.png,icon.ico,icon.icns}  — installer + packaged app
 *   resources/icon.png                             — the running app's window/dock icon
 *   resources/icon-dev.png                         — same, for `pnpm dev`
 * so the packaged app, its installer, the dock and the taskbar all end up
 * wearing the PlanIDE mark.
 *
 * No image library is installed here, and none is needed: Chromium rasterises
 * the SVG (the same engine that will draw it in the app), and ICO/ICNS are thin
 * containers around PNGs, written here by hand. Both are re-parsed afterwards
 * rather than trusted.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '../..')
const OUT = join(ROOT, 'ide/overlay/resources/build')
mkdirSync(OUT, { recursive: true })

const svg = readFileSync(join(ROOT, 'assets/icon.svg'), 'utf8')
const pw = await import('/opt/node22/lib/node_modules/playwright/index.js')
const chromium = pw.chromium ?? pw.default?.chromium
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })

/** Rasterise the mark at one size, on a transparent background. */
async function png(size, art = svg) {
  const page = await browser.newPage({ viewport: { width: size, height: size } })
  await page.setContent(
    `<html><body style="margin:0;background:transparent">
       <div style="width:${size}px;height:${size}px">${art.replace(/width="128" height="128"/, `width="${size}" height="${size}"`)}</div>
     </body></html>`
  )
  const buf = await page.screenshot({ omitBackground: true })
  await page.close()
  return buf
}

const SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024]
const shots = new Map()
for (const s of SIZES) shots.set(s, await png(s))

// Orca ships a separate dev icon so a `pnpm dev` window is never mistaken for
// the real app. Keep that: same mark, amber where the brand red is.
// Dev build wears an amber pulsar so a `pnpm dev` window is never mistaken for
// the real app: swap the cyan/violet beams for warm amber tones.
const devArt = svg
  .replaceAll('#8ab4ff', '#f59e0b')
  .replaceAll('#38bdf8', '#f59e0b')
  .replaceAll('#b39bff', '#fbbf24')
  .replaceAll('#6d4fe0', '#b45309')
  .replaceAll('#c9d8ff', '#fde68a')
const devIcon = await png(256, devArt)
await browser.close()

const RES = join(ROOT, 'ide/overlay/resources')
mkdirSync(RES, { recursive: true })
writeFileSync(join(RES, 'icon.png'), shots.get(256))
writeFileSync(join(RES, 'icon-dev.png'), devIcon)

// --- PNG (linux, and the source electron-builder resizes from) --------------
writeFileSync(join(OUT, 'icon.png'), shots.get(1024))

// --- ICO: header, one directory entry per size, then the PNGs ---------------
// PNG-compressed entries are read by every Windows since Vista.
{
  const sizes = [16, 24, 32, 48, 64, 128, 256]
  const head = Buffer.alloc(6)
  head.writeUInt16LE(0, 0) // reserved
  head.writeUInt16LE(1, 2) // type: icon
  head.writeUInt16LE(sizes.length, 4)
  const entries = []
  const bodies = []
  let offset = 6 + sizes.length * 16
  for (const s of sizes) {
    const body = shots.get(s)
    const e = Buffer.alloc(16)
    e.writeUInt8(s >= 256 ? 0 : s, 0) // 0 means 256
    e.writeUInt8(s >= 256 ? 0 : s, 1)
    e.writeUInt8(0, 2) // palette
    e.writeUInt8(0, 3) // reserved
    e.writeUInt16LE(1, 4) // colour planes
    e.writeUInt16LE(32, 6) // bits per pixel
    e.writeUInt32LE(body.length, 8)
    e.writeUInt32LE(offset, 12)
    entries.push(e)
    bodies.push(body)
    offset += body.length
  }
  writeFileSync(join(OUT, 'icon.ico'), Buffer.concat([head, ...entries, ...bodies]))
}

// --- ICNS: magic, length, then typed PNG chunks -----------------------------
{
  const types = [
    ['icp4', 16], ['icp5', 32], ['icp6', 64],
    ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024],
    ['ic11', 32], ['ic12', 64], ['ic13', 256], ['ic14', 512]
  ]
  const chunks = types.map(([type, size]) => {
    const body = shots.get(size)
    const head = Buffer.alloc(8)
    head.write(type, 0, 4, 'ascii')
    head.writeUInt32BE(body.length + 8, 4)
    return Buffer.concat([head, body])
  })
  const payload = Buffer.concat(chunks)
  const head = Buffer.alloc(8)
  head.write('icns', 0, 4, 'ascii')
  head.writeUInt32BE(payload.length + 8, 4)
  writeFileSync(join(OUT, 'icon.icns'), Buffer.concat([head, payload]))
}

console.log('icons ->', OUT)
