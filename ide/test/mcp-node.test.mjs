/**
 * Node MCP server test: the real server, driven over real MCP stdio frames.
 *
 * Two things this has to prove, because they are the two ways it can silently
 * stop working:
 *
 *  1. The protocol. It is spawned as a child process and driven with the exact
 *     handshake an agent sends (initialize -> initialized -> tools/list ->
 *     tools/call), and nothing but JSON-RPC may appear on stdout.
 *  2. Parity with the IDE. It writes the same `.planide/state.json` the app
 *     reads, so what an agent writes has to load cleanly in the real
 *     TypeScript store (PULSAR_STORE_CJS) and agree with its rollups. That is
 *     what keeps the two implementations from drifting apart.
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = process.env.PULSAR_REPO || join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SERVER = join(REPO, 'ide/agent-bundle/tracker/mcp/planide-mcp.mjs')
const store = await import(process.env.PULSAR_STORE_CJS)

let pass = 0, fail = 0
const ok = (n, c) => c ? (pass++, console.log('  PASS ' + n)) : (fail++, console.log('  FAIL ' + n))

/** Send a batch of frames to a fresh server and collect the replies. */
function drive(frames) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SERVER], { stdio: ['pipe', 'pipe', 'pipe'] })
    let out = '', err = ''
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))
    child.on('error', reject)
    child.on('close', () => {
      const replies = out.split('\n').filter(Boolean).map((l) => JSON.parse(l))
      resolve({ replies, stderr: err })
    })
    for (const f of frames) child.stdin.write(JSON.stringify(f) + '\n')
    child.stdin.end()
    setTimeout(() => child.kill(), 15000).unref?.()
  })
}

const call = (id, name, args) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } })
const text = (r) => r.result.content[0].text
const json = (r) => JSON.parse(text(r))
const byId = (replies, id) => replies.find((r) => r.id === id)

const proj = mkdtempSync(join(tmpdir(), 'pulsar-mcp-'))
mkdirSync(join(proj, 'src'))

// --- the handshake, exactly as an agent sends it --------------------------- //
const hs = await drive([
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2026-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } },
  { jsonrpc: '2.0', method: 'notifications/initialized' },
  { jsonrpc: '2.0', id: 2, method: 'tools/list' }
])
const init = byId(hs.replies, 1)
ok('initialize answers with server info + protocol', init?.result?.serverInfo?.name === 'planide' && init.result.protocolVersion === '2026-06-18')
ok('capabilities advertise tools', Boolean(init?.result?.capabilities?.tools))
ok('a notification is never answered (2 frames for 3 messages)', hs.replies.length === 2)
const tools = byId(hs.replies, 2).result.tools.map((t) => t.name)
ok('every tracker tool is listed, roadmap included',
  ['get_board', 'add_item', 'set_item', 'add_fix', 'mark_fixed', 'add_version', 'add_milestone', 'set_milestone'].every((t) => tools.includes(t)))
ok('every tool takes project and declares a schema',
  byId(hs.replies, 2).result.tools.every((t) => t.inputSchema?.properties?.project && t.inputSchema.required.includes('project')))
ok('nothing but protocol frames on stdout', hs.stderr.length === 0 || !hs.stderr.includes('{'))

// --- the lifecycle an agent actually drives -------------------------------- //
const run = await drive([
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
  call(10, 'add_item', { project: proj, title: 'Login page', status: 'todo', agent: 'codex' }),
  call(11, 'add_item', { project: proj, title: 'Session cookies', status: 'wip', agent: 'codex' }),
  call(12, 'add_fix', { project: proj, title: 'Logout 500s', problem: 'auth.ts:88 throws', agent: 'codex' }),
  call(13, 'get_board', { project: proj })
])
const first = json(byId(run.replies, 10))
ok('add_item creates the board from nothing and returns an id', first.id.startsWith('i_') && first.status === 'todo')
const fixId = json(byId(run.replies, 12)).id
const board = json(byId(run.replies, 13))
ok('get_board reports what was written', board.items.length === 2 && board.fixes.length === 1)
ok('progress rollups are computed', board.progress.open === 2 && board.progress.open_fixes === 1)

// --- move an item, close the fix, cut a version ---------------------------- //
const run2 = await drive([
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
  call(20, 'set_item', { project: proj, item_id: first.id, status: 'works', agent: 'codex' }),
  call(21, 'mark_fixed', { project: proj, fix_id: fixId, solution: 'guard the null session' }),
  call(22, 'add_version', { project: proj, version: '0.2.0', added: ['Login page'] })
])
ok('set_item moves an item', json(byId(run2.replies, 20)).status === 'works')
ok('mark_fixed closes a fix', json(byId(run2.replies, 21)).status === 'fixed')
ok('add_version records a release', json(byId(run2.replies, 22)).version === '0.2.0')

// --- the roadmap: the tool whose absence meant no roadmap was ever created -- //
const run2b = await drive([
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
  call(23, 'add_milestone', { project: proj, title: 'Ship the beta', target: 'v0.3.0', agent: 'codex' }),
  call(24, 'get_board', { project: proj })
])
const milestone = json(byId(run2b.replies, 23))
ok('add_milestone creates a roadmap entry', milestone.id.startsWith('m_') && milestone.target === 'v0.3.0')
ok('get_board reports the roadmap back', json(byId(run2b.replies, 24)).roadmap.some((m) => m.id === milestone.id))
const run2c = await drive([
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
  call(25, 'set_milestone', { project: proj, milestone_id: milestone.id, done: true })
])
ok('set_milestone closes it', json(byId(run2c.replies, 25)).done === true)
ok('the IDE store sees the same roadmap', store.loadState(proj).roadmap.some((m) => m.id === milestone.id && m.done === true))

// Finished work must be able to reach 'done' -- it was piling up in 'works'.
const run2d = await drive([
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
  call(26, 'set_item', { project: proj, item_id: first.id, status: 'done', agent: 'codex' })
])
ok('an item can be closed out to done', json(byId(run2d.replies, 26)).status === 'done')

// --- the trust boundary, as it stands now ---------------------------------- //
// Reporting `works`/`done` DOES confirm an item -- that is the point, the board
// goes green as work lands. What stays true is that the confirmation is the
// agent's and says so, and that `locked` is never the agent's to touch. A
// payload field is still not a way in: confirmation only ever happens as a
// consequence of a real status change.
const run3 = await drive([
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
  call(30, 'set_item', { project: proj, item_id: first.id, verified: true, locked: true, status: 'works', agent: 'Codex' }),
  call(31, 'add_item', { project: proj, title: 'Sneaky', verified: true, locked: true })
])
const afterSneak = store.loadState(proj)
const moved = afterSneak.items.find((i) => i.id === first.id)
ok('reporting works confirms the item', moved.verified === true)
ok('the confirmation is attributed to the agent, never to you',
  moved.verified_by === 'Codex')
ok('set_item still cannot protect an item', moved.locked === false)
ok('add_item cannot confirm or protect via a payload field',
  afterSneak.items.every((i) => (i.title !== 'Sneaky' || (i.verified === false && i.locked === false))))
// A status change that is not works/done must NOT leave a stale confirmation.
const run3b = await drive([
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
  call(32, 'set_item', { project: proj, item_id: first.id, status: 'broken', agent: 'Codex' })
])
const broke = store.loadState(proj).items.find((i) => i.id === first.id)
ok('moving off works drops the confirmation', broke.verified === false && broke.verified_by === '')

// a user confirmation is dropped when the agent changes the status again
store.verifyItem(afterSneak, first.id, true)
store.saveState(proj, afterSneak)
const run4 = await drive([
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
  call(40, 'set_item', { project: proj, item_id: first.id, status: 'broken', agent: 'codex' })
])
ok('a status change drops the user confirmation', json(byId(run4.replies, 40)).verified === false)

// --- parity with the IDE's own store --------------------------------------- //
const loaded = store.loadState(proj)
// 3 items: the two real ones plus the "Sneaky" one the trust-boundary check added.
ok('the IDE store loads what the MCP server wrote', loaded.items.length === 3 && loaded.fixes.length === 1)
ok('ids/versions/activity match the IDE schema',
  loaded.items.every((i) => i.id.startsWith('i_') && typeof i.created_at === 'string' && Array.isArray(i.tags)) &&
  loaded.fixes.every((f) => f.id.startsWith('f_')) &&
  loaded.version === '0.2.0' && loaded.activity.every((a) => a.id.startsWith('a_') && a.at && a.kind))
const prog = store.progress(loaded)
ok('the IDE store agrees on the rollups', prog.total_items === 3 && prog.open_fixes === 0 && prog.broken === 1)
ok('agent work is attributed, not anonymous', loaded.activity.some((a) => a.who === 'codex'))
const raw = JSON.parse(readFileSync(join(proj, '.planide', 'state.json'), 'utf8'))
ok('the state file is the same shape the app reads', Array.isArray(raw.items) && Array.isArray(raw.activity) && typeof raw.github === 'object')

// --- errors come back as results the model can correct, not crashes -------- //
const run5 = await drive([
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
  call(50, 'set_item', { project: proj, item_id: 'i_nope' }),
  call(51, 'add_item', { project: join(tmpdir(), 'definitely-not-here-' + Date.now()), title: 'x' }),
  call(52, 'nonexistent_tool', { project: proj }),
  { jsonrpc: '2.0', id: 53, method: 'tools/call', params: { name: 'get_board', arguments: {} } }
])
ok('an unknown item id is a correctable tool error', byId(run5.replies, 50).result.isError === true && text(byId(run5.replies, 50)).includes('i_nope'))
ok('a missing project path is refused', byId(run5.replies, 51).result.isError === true)
ok('an unknown tool is a protocol error', Boolean(byId(run5.replies, 52).error))
ok('a missing project argument is refused', byId(run5.replies, 53).result.isError === true)
ok('the server survived every bad call', run5.replies.length === 5)

// --- a malformed frame must not kill the server ---------------------------- //
const run6 = await new Promise((resolve) => {
  const child = spawn(process.execPath, [SERVER], { stdio: ['pipe', 'pipe', 'pipe'] })
  let out = ''
  child.stdout.on('data', (d) => (out += d))
  child.on('close', () => resolve(out.split('\n').filter(Boolean).map((l) => JSON.parse(l))))
  child.stdin.write('this is not json\n')
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 60, method: 'ping' }) + '\n')
  child.stdin.end()
})
ok('a malformed frame is dropped and the server keeps serving', run6.length === 1 && run6[0].id === 60)

console.log(`\nPASS=${pass} FAIL=${fail}`)
process.exit(fail ? 1 : 0)
