/**
 * memory-status deploy test: the real module against temp project + HOME dirs.
 *
 * Bundled with esbuild and run by ide/verify.sh (plain Node fs, no Electron).
 * Proves the Tracker's "Project memory" panel reports graphify's graph and the
 * Obsidian note the way council-memory.py actually writes them — same slug, same
 * vault-resolution order — so the two never silently disagree.
 */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = process.env.PULSAR_REPO || join(dirname(fileURLToPath(import.meta.url)), '..', '..')

const MOD = process.env.PULSAR_MEMSTATUS_CJS
const { memoryStatus } = await import(MOD)

let pass = 0, fail = 0
const ok = (n, c) => c ? (pass++, console.log('  PASS ' + n)) : (fail++, console.log('  FAIL ' + n))

// --- a project with a graphify graph + a matching Obsidian note ------------ //
const work = mkdtempSync(join(tmpdir(), 'pulsar-mem-'))
const proj = join(work, 'MyProject'); mkdirSync(proj)
const gout = join(proj, 'graphify-out'); mkdirSync(gout)
writeFileSync(join(gout, 'graph.json'), JSON.stringify({ nodes: [1, 2, 3], edges: [1, 2] }))
writeFileSync(join(gout, 'GRAPH_REPORT.md'), '# report')
writeFileSync(join(gout, 'graph.html'), '<html></html>')

const HOME = join(work, 'home'); mkdirSync(HOME)
const vault = join(work, 'vault'); mkdirSync(vault)
mkdirSync(join(HOME, '.config/pulsaride'), { recursive: true })
writeFileSync(join(HOME, '.config/pulsaride/dashboard-settings.json'), JSON.stringify({ obsidian_vault_path: vault }))
// council-memory.py's slug("MyProject") === "myproject"
mkdirSync(join(vault, 'Pulsar'), { recursive: true })
writeFileSync(join(vault, 'Pulsar', 'myproject.md'), '# MyProject\n')

const s = memoryStatus(proj, HOME)
ok('graphify available with correct node/edge counts', s.graphify.available && s.graphify.nodes === 3 && s.graphify.edges === 2)
ok('graphify report + html detected', s.graphify.hasReport === true && s.graphify.hasHtml === true)
ok('graphify updatedAt is a real timestamp', typeof s.graphify.updatedAt === 'number' && s.graphify.updatedAt > 0)

// --- against a REAL `graphify extract` output, not a synthetic fixture ------ //
// PULSAR_REAL_GRAPH points at a project graphed by the actual CLI, so the
// summary is proven against the schema graphify really writes (node-link JSON:
// `links`, not `edges`) rather than one we assumed.
{
  const fixture = join(REPO, 'ide/test/fixtures/real-graphify-project')
  const real = memoryStatus(fixture, HOME).graphify
  ok('real graph: parsed with nodes and edges', real.available && real.nodes > 0 && real.edges > 0)
  ok('real graph: reads the node-link `links` key', real.edges === 9 && real.nodes === 6)
  ok('real graph: communities counted', real.communities === 2)
  ok('real graph: indexed files from graphify manifest', real.indexedFiles === 2)
  ok('real graph: hubs ranked by degree with a label and file',
    real.hubs.length > 0 && real.hubs[0].degree >= real.hubs[real.hubs.length - 1].degree &&
    real.hubs.every((h) => typeof h.label === 'string' && h.label.length > 0))
  ok('real graph: relation breakdown, biggest first',
    real.relations.length > 0 && real.relations[0].count >= real.relations[real.relations.length - 1].count &&
    real.relations.some((r) => r.name === 'calls'))
  ok('real graph: confidence breakdown (graphify tags every edge)',
    real.confidence.some((c) => c.name === 'EXTRACTED'))
  ok('real graph: node kinds counted', real.kinds.some((k) => k.name === 'code'))
  ok('real graph: not flagged too large', real.tooLarge === false && real.sizeBytes > 0)
}
ok('obsidian vault resolved from pulsaride settings', s.obsidian.vault === vault)
ok('obsidian note found at <vault>/Pulsar/<slug>.md (slug matches council-memory.py)',
  s.obsidian.noteExists === true && s.obsidian.notePath === join(vault, 'Pulsar', 'myproject.md'))

// --- "links" alias for edges (graphify has used both across versions) ------ //
const proj2 = join(work, 'p2'); mkdirSync(proj2)
mkdirSync(join(proj2, 'graphify-out'))
writeFileSync(join(proj2, 'graphify-out', 'graph.json'), JSON.stringify({ nodes: [1], links: [1, 2, 3, 4] }))
const s2 = memoryStatus(proj2, HOME)
ok('graphify edges fall back to "links" when "edges" is absent', s2.graphify.edges === 4 && s2.graphify.nodes === 1)

// --- no graph, no note: a normal "not yet" state, never an error ----------- //
const proj3 = join(work, 'empty'); mkdirSync(proj3)
const HOME3 = join(work, 'home3'); mkdirSync(HOME3) // no vault, no obsidian.json
const s3 = memoryStatus(proj3, HOME3)
ok('no graph -> available false, zero counts', s3.graphify.available === false && s3.graphify.nodes === 0)
ok('no vault -> vault null, note not found', s3.obsidian.vault === null && s3.obsidian.noteExists === false)

// --- OBSIDIAN_VAULT_PATH env wins over settings ---------------------------- //
const vault2 = join(work, 'vault2'); mkdirSync(vault2)
process.env.OBSIDIAN_VAULT_PATH = vault2
const s4 = memoryStatus(proj, HOME)
ok('OBSIDIAN_VAULT_PATH env takes priority', s4.obsidian.vault === vault2 && s4.obsidian.noteExists === false)
delete process.env.OBSIDIAN_VAULT_PATH

console.log(`\nPASS=${pass} FAIL=${fail}`)
process.exit(fail ? 1 : 0)
