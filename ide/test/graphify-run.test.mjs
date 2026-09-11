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
const { reindexGraph, readGraphReport, classifyReportSection, communitiesAreUnlabelled } = await import(MOD)

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

// --- which sections are worth putting in front of someone ------------------ //
// The IDE runs `cluster-only --no-label` so the graph needs no API key, and the
// price is that communities are never named. Four sections then say nothing --
// and they sit ABOVE the four that do, which is the whole "moet helemaal naar
// beneden scrollen, staan dingen wat ik niets aan heb" complaint. This uses a
// fixture rather than a real run so the rule is covered on every machine, not
// just one with graphify installed.
{
  const fx = mkdtempSync(join(tmpdir(), 'pulsar-report-'))
  mkdirSync(join(fx, 'graphify-out'), { recursive: true })
  writeFileSync(
    join(fx, 'graphify-out', 'GRAPH_REPORT.md'),
    [
      '# Graph Report - fixture',
      '',
      '## Corpus Check',
      '- cluster-only mode — file stats not available',
      '',
      '## Summary',
      '- 71 nodes · 110 edges · 10 communities',
      '',
      '## Community Hubs (Navigation)',
      '- Community 0',
      '- Community 1',
      '',
      '## God Nodes (most connected - your core abstractions)',
      '1. `logActivity()` - 11 edges',
      '',
      '## Surprising Connections (you probably didn\'t know these)',
      '- `A` --calls--> `B`  [EXTRACTED]',
      '',
      '## Import Cycles',
      '- None detected.',
      '',
      '## Communities (10 total, 1 thin omitted)',
      '### Community 0 - "Community 0"',
      'Cohesion: 0.11',
      '### Community 1 - "Community 1"',
      'Cohesion: 0.20',
      '',
      '## Knowledge Gaps',
      '- **29 isolated node(s):** `Activity`',
      '',
      '## Suggested Questions',
      '- **Why does `nowIso()` connect `Community 2` to `Community 0`?**'
    ].join('\n')
  )
  const secs = readGraphReport(fx)
  const by = (name) => secs.find((s) => s.heading.toLowerCase().startsWith(name))
  ok('an unlabelled report is recognised as unlabelled', communitiesAreUnlabelled(secs) === true)
  ok('the sections that carry real symbols and paths lead',
    by('god nodes').useful && by('surprising connections').useful &&
    by('import cycles').useful && by('knowledge gaps').useful && by('summary').useful)
  ok('the ones that are just "Community N" are demoted',
    !by('community hubs').useful && !by('communities (').useful && !by('suggested questions').useful)
  ok('a section that says its own data is unavailable is demoted', !by('corpus check').useful)

  // ...but only BECAUSE they are unnamed. A labelled report keeps them.
  const labelled = [
    { heading: 'Communities (2 total)', lines: ['### Community 0 - "Tracker store"', 'Cohesion: 0.5'] }
  ]
  ok('a report whose communities have real names is not treated as unlabelled',
    communitiesAreUnlabelled(labelled) === false)
  ok('and then those sections are worth showing again',
    classifyReportSection('Communities (2 total)', labelled[0].lines, false) === true &&
    classifyReportSection('Suggested Questions', ['- why?'], false) === true)

  // An unknown heading from a future graphify version must not be swallowed.
  ok('a section this list has never heard of is shown, not hidden',
    classifyReportSection('Dependency Risk', ['- something new'], true) === true)
}

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
  // Against a REAL report, not a fixture: the split has to actually fire.
  ok('a real report is split into a useful half and a quiet half',
    after.some((s) => s.useful) && after.some((s) => !s.useful))
  ok('god nodes are never in the quiet half',
    after.filter((s) => !s.useful).every((s) => !s.heading.toLowerCase().startsWith('god nodes')))
}

console.log(`\nPASS=${pass} FAIL=${fail}`)
process.exit(fail ? 1 : 0)
