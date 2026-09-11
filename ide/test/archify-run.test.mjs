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
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const MOD = process.env.PULSAR_ARCHIFYRUN_CJS
const { archifyRender, archifyStatus, ARCHIFY_TYPES, ensureBaselineDiagram } = await import(MOD)

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

// --- the baseline diagram -------------------------------------------------- //
// "Archify wordt niet automatisch gemaakt": the tab only ever showed JSON an
// agent had already written, so a project nobody authored one for was blank.
// The generated one has to be REAL archify input, not merely well-intentioned
// -- so it is rendered through the same CLI as everything above. A hand-checked
// JSON shape would prove nothing; archify validates against its own schema.
const fresh = join(work, 'fresh-project')
for (const d of ['src', 'api', 'migrations', 'auth', 'infra', 'docs', 'node_modules', '.git', 'weird name!']) {
  mkdirSync(join(fresh, d), { recursive: true })
}
const made = ensureBaselineDiagram(fresh, { title: 'Fresh Project' })
ok('a project with no diagrams gets a baseline', made.created === true && made.type === 'architecture')

const baseline = JSON.parse(readFileSync(join(fresh, '.planide/diagrams/project-map.architecture.json'), 'utf8'))
const labels = baseline.components.map((c) => c.label)
ok('build output and dotfiles are not drawn as components',
   !labels.includes('node_modules') && !labels.includes('.git') &&
   labels.includes('src') && labels.includes('api'))
ok('directory names are classified, not all lumped together',
   baseline.components.find((c) => c.label === 'migrations')?.type === 'database' &&
   baseline.components.find((c) => c.label === 'auth')?.type === 'security' &&
   baseline.components.find((c) => c.label === 'infra')?.type === 'cloud' &&
   baseline.components.find((c) => c.label === 'src')?.type === 'backend')
ok('a directory name that is not a legal archify id is made into one',
   baseline.components.every((c) => /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(c.id)))
// The honesty rule: it states what exists, it does not invent how they relate.
ok('no relationships are invented', baseline.connections === undefined)

const renderedBaseline = await archifyRender(fresh, 'project-map', 'architecture', HOME)
ok('the generated baseline is valid archify input and really renders',
   renderedBaseline.ok === true && !!renderedBaseline.html && existsSync(renderedBaseline.html))
if (!renderedBaseline.ok) console.log('       archify said: ' + String(renderedBaseline.log).split('\n').slice(0, 3).join(' | '))

// Never twice, and never over an authored set.
const again = ensureBaselineDiagram(fresh, { title: 'Fresh Project' })
ok('it is not written a second time', again.created === false && again.reason === 'exists')
ok('the existing project with real diagrams is left alone',
   ensureBaselineDiagram(proj).created === false)

const bare = join(work, 'bare-project')
mkdirSync(bare, { recursive: true })
ok('a project with nothing in it gets no diagram rather than an empty one',
   ensureBaselineDiagram(bare).created === false)

console.log(`\nPASS=${pass} FAIL=${fail}`)
process.exit(fail ? 1 : 0)
