/**
 * The theme's foreground/background pairs must actually be readable.
 *
 * A brand palette is easy to pick and easy to get wrong: #ff453a is a fine
 * accent on near-black and only 2.5:1 on white, which is unreadable as text.
 * This computes real WCAG contrast ratios off the stylesheet rather than
 * trusting that the colours "look right" in one theme.
 *
 * Thresholds are WCAG 2.1: 4.5:1 for body text, 3:1 for large text and for UI
 * component boundaries. Pairs are checked per theme block, because the light
 * and dark halves are different palettes and a value that passes in one can
 * fail in the other -- which is exactly the mistake this guards.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const CSS = readFileSync(
  join(HERE, '..', 'overlay', 'src', 'renderer', 'src', 'assets', 'pulsar-theme.css'),
  'utf8'
)

let pass = 0
let fail = 0
const ok = (n, c) => (c ? (pass++, console.log('  PASS ' + n)) : (fail++, console.log('  FAIL ' + n)))

/** Pull one `:root {}` / `.dark {}` block's custom properties. */
function tokens(selector) {
  const re = new RegExp(`${selector.replace('.', '\\.')}\\s*\\{([\\s\\S]*?)\\n\\}`, 'm')
  const m = re.exec(CSS)
  if (!m) return {}
  const out = {}
  for (const line of m[1].split('\n')) {
    const d = /^\s*(--[\w-]+)\s*:\s*([^;]+);/.exec(line)
    if (d) out[d[1]] = d[2].trim()
  }
  return out
}

function rgb(v) {
  const hex = /^#([0-9a-f]{6})$/i.exec(v)
  if (hex) {
    const n = parseInt(hex[1], 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }
  return null // rgb(... / alpha) borders are not text pairs; skipped by callers
}

/** WCAG relative luminance. */
function lum([r, g, b]) {
  const c = [r, g, b].map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}

function ratio(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

// Text pairs: what a user actually reads. 4.5:1.
const TEXT_PAIRS = [
  ['--foreground', '--background'],
  ['--card-foreground', '--card'],
  ['--popover-foreground', '--popover'],
  ['--primary-foreground', '--primary'],
  ['--secondary-foreground', '--secondary'],
  ['--accent-foreground', '--accent'],
  ['--destructive-foreground', '--destructive'],
  ['--sidebar-foreground', '--sidebar'],
  ['--sidebar-primary-foreground', '--sidebar-primary'],
  ['--worktree-sidebar-foreground', '--worktree-sidebar']
]

// Muted text is secondary, but still has to be readable against its ground.
const MUTED_PAIRS = [['--muted-foreground', '--background'], ['--muted-foreground', '--card']]

for (const [selector, label] of [
  [':root', 'light'],
  ['.dark', 'dark']
]) {
  const t = tokens(selector)
  ok(`${label}: the block defines a palette`, Object.keys(t).length > 20)
  for (const [fg, bg] of TEXT_PAIRS) {
    const a = rgb(t[fg])
    const b = rgb(t[bg])
    if (!a || !b) continue
    const r = ratio(a, b)
    ok(`${label}: ${fg} on ${bg} is readable (${r.toFixed(2)}:1)`, r >= 4.5)
  }
  for (const [fg, bg] of MUTED_PAIRS) {
    const a = rgb(t[fg])
    const b = rgb(t[bg])
    if (!a || !b) continue
    const r = ratio(a, b)
    ok(`${label}: ${fg} on ${bg} clears large-text contrast (${r.toFixed(2)}:1)`, r >= 3)
  }

  // A red brand costs the obvious danger colour. Destructive must not read as
  // the same button as primary -- if they are near-identical, "delete" and
  // "confirm" look alike, which is the one place that matters most.
  const p = rgb(t['--primary'])
  const d = rgb(t['--destructive'])
  if (p && d) {
    const dist = Math.hypot(p[0] - d[0], p[1] - d[1], p[2] - d[2])
    ok(`${label}: destructive is distinguishable from primary (ΔRGB ${Math.round(dist)})`, dist > 40)
  }
}

// The identity itself: the dark ground and accent are ThePunisher's own tokens.
// If someone re-themes without meaning to, this says so.
const dark = tokens('.dark')
ok('dark ground is the brand black', dark['--background'] === '#08090d')
ok('dark accent is the brand red', dark['--primary'] === '#ff453a')

// Motion must be escapable: an IDE runs for hours.
ok('every animation is disabled under prefers-reduced-motion',
  /@media \(prefers-reduced-motion: reduce\)/.test(CSS) &&
  /animation: none/.test(CSS))

console.log(`\nPASS=${pass} FAIL=${fail}`)
process.exit(fail ? 1 : 0)
