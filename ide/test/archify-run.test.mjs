/**
 * Archify integration test: the real module, the real bundled archify.
 *
 * This exists because of a bug that reached a user: `archifyRender` passed
 * `--repo-root` for every diagram type, but archify accepts that flag for
 * architecture only and rejects the whole render otherwise. Four of the five
 * types could therefore never render -- reported as "render niet eens" on a
 * data-flow diagram. Nothing caught it because archify had no test at all.
 *
 * So this renders one diagram of EVERY type through the real code path, using
 * the examples archify itself ships. It is slower than a unit test, and that is
 * the point: a mock of the CLI would have happily accepted the bad flag too.
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const MOD = process.env.PULSAR_ARCHIFYRUN_CJS
const { archifyRender, archifyStatus, ARCHIFY_TYPES } = await import(MOD)

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SKILL = join(REPO, 'ide/agent-bundle/skills/archify')

let pass = 0, fail = 0
const ok = (n, c) => (c ? (pass++, console.log('  PASS ' + n)) : (fail++, console.log('  FAIL ' + n)))

// A HOME whose .claude/skills/archify is the bundled copy -- the same place
// deployTrackerFiles/skills put it on a real machine.
const work = mkdtempSync(join(tmpdir(), 'pulsar-archify-'))
const HOME = join(work, 'home')
mkdirSync(join(HOME, '.claude', 'skills'), { recursive: true })
cpSync(SKILL, join(HOME, '.claude', 'skills', 'archify'), { recursive: true })

const proj = join(work, 'project')
const diagrams = join(proj, '.planide', 'diagrams')
mkdirSync(diagrams, { recursive: true })

// One real example per type, named the way the IDE expects on disk.
const EXAMPLES = {
  architecture: 'web-app.architecture.json',
  workflow: 'release-delivery.workflow.json',
  sequence: 'cache-miss-request.sequence.json',
  dataflow: 'event-stream.dataflow.json',
  lifecycle: 'agent-run.lifecycle.json'
}
ok('an example is covered for every type archify accepts',
   ARCHIFY_TYPES.every((t) => EXAMPLES[t]) && Object.keys(EXAMPLES).length === ARCHIFY_TYPES.length)

for (const [type, file] of Object.entries(EXAMPLES)) {
  cpSync(join(SKILL, 'examples', file), join(diagrams, `demo.${type}.json`))
}

const listed = archifyStatus(proj, HOME)
ok('the bundled archify is found', listed.available === true)
ok('every diagram on disk is listed', listed.diagrams.length === ARCHIFY_TYPES.length)
ok('nothing is rendered yet', listed.diagrams.every((d) => !d.html))

// The regression itself: every type has to render, not just architecture.
for (const type of ARCHIFY_TYPES) {
  const res = await archifyRender(proj, 'demo', type, HOME)
  ok(`${type} renders`, res.ok === true && !!res.html && existsSync(res.html))
  if (!res.ok) console.log('       archify said: ' + String(res.log).split('\n')[0])
}

const after = archifyStatus(proj, HOME)
ok('the panel now sees rendered HTML for each', after.diagrams.every((d) => !!d.html))
ok('and none of them read as stale', after.diagrams.every((d) => d.stale === false))

// Guards that must survive any future change to the argument building.
const bogus = await archifyRender(proj, 'demo', 'not-a-type', HOME)
ok('an unknown type is refused, never shelled out', bogus.ok === false && bogus.missing === false)

const absent = await archifyRender(proj, 'demo', 'dataflow', join(work, 'no-such-home'))
ok('a missing archify reads as missing, not as a render failure',
   absent.ok === false && absent.missing === true)

const nope = await archifyRender(proj, 'does-not-exist', 'dataflow', HOME)
ok('a diagram that is not on disk is refused', nope.ok === false && nope.missing === false)

console.log(`\nPASS=${pass} FAIL=${fail}`)
process.exit(fail ? 1 : 0)
