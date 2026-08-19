/**
 * Format contract: the IDE's tracker (TypeScript) and the agent tools (Python)
 * share one file, `<project>/.planide/state.json`.
 *
 * Given a project the Python tools just wrote, this asserts the IDE's own store
 * reads it and derives the same picture — the check that keeps two
 * implementations of one format from silently drifting apart.
 *
 * Usage: node ide/test/state-compat.mjs <project-path>
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const project = process.argv[2]
if (!project) {
  console.error('usage: state-compat.mjs <project-path>')
  process.exit(2)
}

// Bundle the IDE's store so it can run outside Electron.
const work = mkdtempSync(join(tmpdir(), 'planide-compat-'))
const entry = join(work, 'entry.ts')
writeFileSync(
  entry,
  `import { loadState, progress, regressions } from '${join(here, '..', 'overlay', 'src', 'main', 'planide', 'store').replace(/\\/g, '/')}'
const st = loadState(process.argv[2])
console.log(JSON.stringify({
  items: st.items.length,
  fixes: st.fixes.length,
  activity: st.activity.length,
  verified: st.items.filter((i) => i.verified).length,
  locked: st.items.filter((i) => i.locked).length,
  claimed: st.items.filter((i) => i.claimed_by).length,
  progress: progress(st),
  regressions: regressions(st).length
}))`
)
const bundle = join(work, 'compat.cjs')
execFileSync(
  'npx',
  ['--yes', 'esbuild', entry, '--bundle', '--platform=node', '--format=cjs', `--outfile=${bundle}`, '--log-level=error'],
  { stdio: 'inherit' }
)

const ide = JSON.parse(execFileSync('node', [bundle, project], { encoding: 'utf8' }))
const raw = JSON.parse(readFileSync(join(project, '.planide', 'state.json'), 'utf8'))

const checks = [
  ['items round-trip', ide.items === raw.items.length],
  ['fixes round-trip', ide.fixes === raw.fixes.length],
  ['activity round-trip', ide.activity === (raw.activity ?? []).length],
  ['verified flags read back', ide.verified === raw.items.filter((i) => i.verified).length],
  ['locked flags read back', ide.locked === raw.items.filter((i) => i.locked).length],
  ['agent attribution read back', ide.claimed === raw.items.filter((i) => i.claimed_by).length],
  ['progress computes', typeof ide.progress.confirmed_percent === 'number'],
  [
    'regressions agree',
    ide.regressions ===
      raw.items.filter((i) => i.locked && ['broken', 'blocked'].includes(i.status)).length
  ]
]

let failed = 0
for (const [name, pass] of checks) {
  if (!pass) {
    failed++
    console.error(`  FAIL ${name}`)
  }
}
if (failed) {
  console.error('IDE saw:', JSON.stringify(ide))
  process.exit(1)
}
console.log(`state format compatible (${checks.length} checks)`)
