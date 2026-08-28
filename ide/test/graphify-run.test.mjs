/**
 * The Brain Graph's "Rebuild graph" button, end to end.
 *
 * The bug this covers: Refresh only ever re-READ `graphify-out/` off disk, so
 * it returned identical numbers every time and was indistinguishable from doing
 * nothing. Nothing in the IDE ever ran graphify. This exercises the real
 * binary -- if graphify is not installed the checks skip rather than fail,
 * because a machine without it is a normal state, not a broken one.
 *
 * It also pins the thing that made the report missing in the first place:
 * `graphify extract` alone does NOT write GRAPH_REPORT.md. graphify's own
 * output says to run `cluster-only` for that, and until this shipped nothing
 * did -- so hasReport was effectively always false.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const MOD = process.env.PULSAR_GRAPHIFYRUN_CJS
const { reindexGraph, readGraphReport } = await import(MOD)

let pass = 0
let fail = 0
const ok = (n, c) => (c ? (pass++, console.log('  PASS ' + n)) : (fail++, console.log('  FAIL ' + n)))
const skip = (n) => console.log('  SKIP ' + n)

// --- a missing project is answered, never thrown --------------------------- //
const gone = await reindexGraph(join(tmpdir(), 'pulsar-not-here-' + Date.now()))
ok('a project directory that is not there fails cleanly', gone.ok === false && gone.log.length > 0)
ok('and is not reported as graphify being missing', gone.missing === false)

// --- no report yet is an empty list, not a crash --------------------------- //
const empty = mkdtempSync(join(tmpdir(), 'pulsar-noreport-'))
ok('a project with no report reads as zero sections', readGraphReport(empty).length === 0)

let haveGraphify = true
try {
  execFileSync('graphify', ['--version'], { stdio: 'ignore', timeout: 8000 })
} catch {
  haveGraphify = false
}

if (!haveGraphify) {
  skip('rebuild against the real graphify (not installed here)')
} else {
  const proj = mkdtempSync(join(tmpdir(), 'pulsar-graph-'))
  mkdirSync(join(proj, 'src', 'lib'), { recursive: true })
  writeFileSync(
    join(proj, 'src', 'index.ts'),
    "import { CartStore } from './lib/cart'\nexport function main(): void { new CartStore().add('x') }\n"
  )
  writeFileSync(
    join(proj, 'src', 'lib', 'cart.ts'),
    'export class CartStore {\n  private l: string[] = []\n  add(s: string): void { this.l.push(s) }\n}\n'
  )

  const before = readGraphReport(proj).length
  const r = await reindexGraph(proj)
  ok('a rebuild reports success against a real project', r.ok === true && r.missing === false)
  ok('graph.json is written', existsSync(join(proj, 'graphify-out', 'graph.json')))
  // The whole point of the second command: extract alone never writes these.
  ok('GRAPH_REPORT.md is written -- extract alone does not do this',
    existsSync(join(proj, 'graphify-out', 'GRAPH_REPORT.md')))
  ok('graph.html is written too', existsSync(join(proj, 'graphify-out', 'graph.html')))

  const after = readGraphReport(proj)
  ok(`the report goes from ${before} sections to ${after.length}`, before === 0 && after.length > 0)
  ok('sections carry graphify\'s own headings and their lines',
    after.every((s) => typeof s.heading === 'string' && s.heading.length > 0 && s.lines.length > 0))
  // These are the sections that make the panel worth reading -- the half the
  // IDE never showed because the report was never generated.
  const headings = after.map((s) => s.heading.toLowerCase()).join(' | ')
  ok('it includes the god-node / most-connected section', headings.includes('god nodes'))
  ok('and the summary', headings.includes('summary'))
}

console.log(`\nPASS=${pass} FAIL=${fail}`)
process.exit(fail ? 1 : 0)
