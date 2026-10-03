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
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

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

/** Same as drive, but from a chosen cwd -- how an agent's own directory reaches the server. */
function driveIn(cwd, frames) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SERVER], { cwd, stdio: ['pipe', 'pipe', 'pipe'] })
    let out = '', err = ''
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))
    child.on('error', reject)
    child.on('close', () => resolve({ replies: out.split('\n').filter(Boolean).map((l) => JSON.parse(l)), stderr: err }))
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
  ['get_board', 'add_item', 'set_item', 'add_fix', 'mark_fixed', 'reopen_fix', 'add_version', 'add_milestone', 'set_milestone', 'sync_plan'].every((t) => tools.includes(t)))
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

// --- a failed write must not litter --------------------------------------- //
// The board is written write-then-rename, with the pid in the temp name so the
// IDE and an agent's server never share one. When renameSync throws -- on
// Windows an AV scanner or the indexer holding the target is enough -- the temp
// used to stay on disk, and because it carries a pid a new orphan accumulated
// per process instead of overwriting the last. Reproduced by making the target
// a directory, which makes rename fail for certain.
{
  const litter = mkdtempSync(join(tmpdir(), 'pulsar-litter-'))
  mkdirSync(join(litter, '.planide'), { recursive: true })
  mkdirSync(join(litter, '.planide', 'state.json'))
  let threw = false
  try {
    store.saveState(litter, { items: [], fixes: [], roadmap: [], versions: [], activity: [] })
  } catch {
    threw = true
  }
  const leftovers = readdirSync(join(litter, '.planide')).filter((f) => f.endsWith('.tmp'))
  ok('a board write that cannot be renamed still fails loudly', threw)
  ok('and cleans up its temp file instead of leaving an orphan', leftovers.length === 0)
}

// --- add_item does not stack duplicates ----------------------------------- //
// Agents re-post their plan every turn, so the same title arrives again and
// again. sync_plan already deduped on the normalised title; add_item -- the tool
// agents call directly -- did not, so a board grew a new row per turn for work
// that was already on it. Same normalised match, and only against items that are
// still OPEN: a title whose only match is 'done' must still be allowed through,
// because real work legitimately recurs.
const dupProj = mkdtempSync(join(tmpdir(), 'pulsar-dup-'))
const dup = await drive([
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
  call(40, 'add_item', { project: dupProj, title: 'Fix the login bug' }),
  call(41, 'add_item', { project: dupProj, title: 'fix   the LOGIN bug!' }),
  call(42, 'get_board', { project: dupProj })
])
const made = json(byId(dup.replies, 40))
const again = json(byId(dup.replies, 41))
ok('re-adding the same work returns the existing item instead of a second row',
  again.id === made.id && again.existing === true)
ok('and the board really holds one item, not two',
  json(byId(dup.replies, 42)).items.length === 1)

// Two passes, because closing the item needs the id the first pass returns.
const doneProj = mkdtempSync(join(tmpdir(), 'pulsar-done-'))
const shipId = json(byId((await drive([
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
  call(45, 'add_item', { project: doneProj, title: 'Ship the release' })
])).replies, 45)).id
const recur2 = await drive([
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
  call(48, 'set_item', { project: doneProj, item_id: shipId, status: 'done' }),
  call(49, 'add_item', { project: doneProj, title: 'Ship the release' }),
  call(50, 'get_board', { project: doneProj })
])
ok('work that was already closed can come back as a new item',
  json(byId(recur2.replies, 49)).existing !== true &&
  json(byId(recur2.replies, 50)).items.length >= 2)
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
// Auto-complete is on by default ("wat werkt mag als afgerond zijn"): an agent
// reporting `works` lands as `done`. The off-switch has its own section below.
ok('set_item moves an item -- works lands as done with auto-complete on',
  json(byId(run2.replies, 20)).status === 'done')
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

// sync_plan: the mechanism every agent has, including the ones with no
// TodoWrite hook. Its own project on purpose -- adding items to the shared
// fixture would move the rollups the parity assertions above check.
const planProj = mkdtempSync(join(tmpdir(), 'pulsar-plan-'))
const planRun = await drive([
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
  call(70, 'sync_plan', { project: planProj, agent: 'Council', todos: [
    { content: 'Draft the schema', status: 'in_progress' },
    { content: 'Write the migration', status: 'pending' }
  ] }),
  // Re-sending a revised plan is the normal case, so what matters is that it
  // moves steps instead of piling up copies.
  call(71, 'sync_plan', { project: planProj, agent: 'Council', todos: [
    { content: 'Draft the schema', status: 'completed' },
    { content: 'Write the migration', status: 'in_progress' },
    { content: 'Backfill the old rows', status: 'pending' }
  ] }),
  call(72, 'get_board', { project: planProj })
])
const plan1 = json(byId(planRun.replies, 70))
const plan2 = json(byId(planRun.replies, 71))
const planBoard = json(byId(planRun.replies, 72))
ok('sync_plan puts a whole plan on the board in one call',
  plan1.added === 2 && plan1.moved === 0)
ok('a revised plan moves what moved and adds what is new -- never duplicates',
  plan2.added === 1 && plan2.moved === 2 &&
  planBoard.items.filter((i) => i.title === 'Draft the schema').length === 1)
ok('and the states land in the board\'s own columns',
  planBoard.items.find((i) => i.title === 'Draft the schema').status === 'done' &&
  planBoard.items.find((i) => i.title === 'Write the migration').status === 'wip' &&
  planBoard.items.find((i) => i.title === 'Backfill the old rows').status === 'todo')
// A plan whose steps do not use `content`. Codex's own update_plan calls the
// field `step`, and a sync that reads nothing used to answer {added: 0, moved: 0}
// -- success, with an empty board. That is exactly what "the todo list does not
// work" looks like from the outside, and nothing anywhere said otherwise.
const shapeProj = mkdtempSync(join(tmpdir(), 'pulsar-shape-'))
const shapeRun = await drive([
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
  call(80, 'sync_plan', { project: shapeProj, agent: 'codex', todos: [
    { step: 'Codex calls it step', status: 'in_progress' }
  ] }),
  // Mixed: throwing here would roll back the steps that were fine, which is
  // strictly worse than the silence it replaces. Keep them, and say what fell out.
  // The whole plan again, as agents send it -- a step left out of a re-sent plan
  // is a step the plan dropped (retireDroppedSteps).
  call(81, 'sync_plan', { project: shapeProj, agent: 'codex', todos: [
    { step: 'Codex calls it step', status: 'in_progress' },
    { content: 'readable', status: 'pending' },
    { unreadable: true }
  ] }),
  call(82, 'get_board', { project: shapeProj })
])
const shape1 = json(byId(shapeRun.replies, 80))
const shape2 = json(byId(shapeRun.replies, 81))
const shapeBoard = json(byId(shapeRun.replies, 82))
ok('a plan using Codex\'s own `step` field lands instead of silently doing nothing',
  shape1.added === 1 &&
  shapeBoard.items.find((i) => i.title === 'Codex calls it step')?.status === 'wip')
ok('a step with no readable text is reported, not counted as a success',
  shape2.added === 1 && shape2.skipped === 1 && /NOT on the board/.test(shape2.warning ?? ''))
ok('and the readable steps of that same plan are kept, not rolled back',
  shapeBoard.items.some((i) => i.title === 'readable'))
// Nothing readable at all is a real failure: no partial work to protect, and
// staying quiet would be the original bug.
const allBad = await drive([
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
  call(83, 'sync_plan', { project: mkdtempSync(join(tmpdir(), 'pulsar-bad-')), agent: 'codex',
    todos: [{ nope: 1 }] })
])
ok('a plan with nothing readable in it fails loudly instead of reporting success',
  byId(allBad.replies, 83).result?.isError === true)

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
  /codex/i.test(moved.verified_by))
// get_board's rollup must draw the same line the board is built on: an agent
// confirming its own work is a claim, not your check. Otherwise an agent asking
// "how far are we" reads back its own claims as confirmed, and the % the IDE
// shows and the % the agent sees disagree.
const boardAC = json(byId((await drive([
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
  call(305, 'get_board', { project: proj })
])).replies, 305))
ok("get_board: an agent's own confirmation is not counted as confirmed by you",
  boardAC.progress.confirmed === 0)
ok('get_board: completion still counts the agent-done work, so % is not stuck at 0',
  boardAC.progress.percent > 0)
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

// --- a fix can come back ---------------------------------------------------- //
// Closing stamps fixed_at. Nothing cleared it when a fix left `fixed`, which was
// invisible until reopen existed: a reopened entry kept claiming the old close
// date, and -- because the engine's guard was `status === 'fixed' && !fixed_at`
// -- the SECOND close logged no activity at all. Both sides are checked here,
// because the MCP server and the IDE store implement this separately.
const runR = await drive([
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
  call(60, 'reopen_fix', { project: proj, fix_id: fixId, note: 'back on prod', agent: 'codex' }),
  call(61, 'get_board', { project: proj })
])
const reopened = json(byId(runR.replies, 60))
const boardR = json(byId(runR.replies, 61))
ok('reopen_fix puts a closed fix back to open', reopened.status === 'open')
ok('reopening clears the stale close date',
  (store.loadState(proj).fixes.find((f) => f.id === fixId) || {}).fixed_at === '')
ok('the reason it came back is kept, not a duplicate entry',
  boardR.fixes.length === 1 && boardR.fixes[0].problem.includes('back on prod'))
ok('reopening is on the activity trail',
  store.loadState(proj).activity.some((a) => a.kind === 'fix-reopen'))

// close it again: the second close has to log, which the old guard swallowed
const runR2 = await drive([
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
  call(62, 'mark_fixed', { project: proj, fix_id: fixId, solution: 'guard the null session, properly', agent: 'codex' })
])
ok('a reopened fix can be closed again', json(byId(runR2.replies, 62)).status === 'fixed')
ok('the second close is recorded too',
  store.loadState(proj).activity.filter((a) => a.kind === 'fix-done').length === 2)

// the IDE store's own updateFix has to agree, since the UI goes through it
{
  const s = store.loadState(proj)
  store.updateFix(s, fixId, { status: 'open' })
  const f = s.fixes.find((x) => x.id === fixId)
  ok('the IDE store clears fixed_at on reopen too', f.status === 'open' && f.fixed_at === '')
  store.updateFix(s, fixId, { status: 'wontfix' })
  ok('and parking is a status of its own, not a close',
    s.fixes.find((x) => x.id === fixId).status === 'wontfix' &&
    s.activity.some((a) => a.kind === 'fix-wontfix'))
  // put it back the way the parity assertions below expect it
  store.updateFix(s, fixId, { status: 'fixed' })
  store.saveState(proj, s)
}

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
  call(52, 'nonexistent_tool', { project: proj })
])
// A missing `project` argument is covered separately below, where the cwd is
// controlled -- it now falls back to the cwd project, so it cannot be asserted
// from here, where the runner's own cwd happens to be a real project.
ok('an unknown item id is a correctable tool error', byId(run5.replies, 50).result.isError === true && text(byId(run5.replies, 50)).includes('i_nope'))
ok('a missing project path is refused', byId(run5.replies, 51).result.isError === true)
ok('an unknown tool is a protocol error', Boolean(byId(run5.replies, 52).error))
ok('the server survived every bad call', run5.replies.length === 4)

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

// --- clean_doc strips AI watermarks without touching real content --------- //
// The dirty string carries one of each mark class next to content that must
// survive: an em-dash, an emoji, CJK, and a sentence a non-breaking space splits.
const dirty = 'The\u200Bplan \u2014 ship it \u2705\u200F, \u4e2d\u6587 ok.\u00a0Done\u{E0061}.\n'
const docDir = mkdtempSync(join(tmpdir(), 'pulsar-doc-'))
const docProj = join(docDir, 'proj')
mkdirSync(docProj)
const sibling = join(docDir, 'proj-evil')
mkdirSync(sibling)
writeFileSync(join(sibling, 'secret.md'), 'left\u200Balone\n', 'utf8')
writeFileSync(join(docProj, 'doc.md'), dirty, 'utf8')
// A second copy: drive() sends the whole batch before we can read anything back,
// so the inspect_only check needs a file no later call in the batch rewrites.
writeFileSync(join(docProj, 'untouched.md'), dirty, 'utf8')

const run7 = await drive([
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
  call(70, 'clean_doc', { project: docProj, path: 'untouched.md', inspect_only: true }),
  call(71, 'clean_doc', { project: docProj, path: 'doc.md' }),
  call(72, 'clean_doc', { project: docProj, path: 'doc.md' }),
  call(73, 'clean_doc', { project: docProj, path: '../proj-evil/secret.md' }),
  call(74, 'clean_doc', { project: docProj, path: 'nope.md' })
])
const inspected = json(byId(run7.replies, 70))
ok('clean_doc counts every mark class it finds',
  inspected.total === 4 && inspected.removed.zeroWidth === 1 && inspected.removed.bidi === 1 &&
  inspected.removed.tags === 1 && inspected.removed.oddSpaces === 1)
ok('inspect_only reports without rewriting the file',
  inspected.written === false && readFileSync(join(docProj, 'untouched.md'), 'utf8') === dirty)
const cleaned = json(byId(run7.replies, 71))
const afterDoc = readFileSync(join(docProj, 'doc.md'), 'utf8')
ok('clean_doc writes the stripped document', cleaned.written === true && cleaned.total === 4)
ok('real content survives -- em-dash, emoji, CJK, and the nbsp becomes a plain space',
  afterDoc === 'Theplan \u2014 ship it \u2705, \u4e2d\u6587 ok. Done.\n')
ok('a second pass finds nothing left to remove', json(byId(run7.replies, 72)).total === 0)
ok('a sibling directory cannot be reached through the project root',
  byId(run7.replies, 73).result.isError === true &&
  readFileSync(join(sibling, 'secret.md'), 'utf8').includes('\u200B'))
ok('a missing document is a correctable tool error', byId(run7.replies, 74).result.isError === true)

// --- a forgotten `project` must not lose the write ------------------------- //
// The tools ask for `project`, but an agent that omits it used to get a bare
// error and the board silently never moved -- the "agents write nothing" report.
// The server now falls back to its own cwd, which for an agent working in the
// IDE terminal is the project, and refuses only when cwd is not a project.
const cwdProj = mkdtempSync(join(tmpdir(), 'pulsar-cwd-'))
mkdirSync(join(cwdProj, '.git'))
const fb = await driveIn(cwdProj, [
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
  call(80, 'add_item', { title: 'no project argument', status: 'todo' }),
  call(81, 'get_board', {})
])
ok('add_item with no project falls back to the cwd project and writes',
  byId(fb.replies, 80).result.isError !== true &&
  existsSync(join(cwdProj, '.planide', 'state.json')))
ok('get_board with no project reads that same cwd board',
  json(byId(fb.replies, 81)).progress.total_items === 1)
ok('the fallback says so on stderr, never on the protocol stream',
  fb.stderr.includes('defaulting to cwd') && !fb.stderr.includes('{"jsonrpc'))

const bareCwd = mkdtempSync(join(tmpdir(), 'pulsar-bare-'))
const noFb = await driveIn(bareCwd, [
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
  call(82, 'add_item', { title: 'x', status: 'todo' })
])
ok('a cwd that is not a project is refused, never scattered with a .planide',
  byId(noFb.replies, 82).result.isError === true && !existsSync(join(bareCwd, '.planide')))

// --- the `id` alias: an agent naturally passes back the `id` that add_* returned
// and get_board shows, so set_item/mark_fixed/set_milestone accept it in place of
// item_id/fix_id/milestone_id. Antigravity has no plan-sync hook, so these manual
// calls have to land first try; the prefixed names still work, this only adds the
// bare alias (the real friction in "antigravity update de tracker niet automatisch").
const aliasProj = mkdtempSync(join(tmpdir(), 'pulsar-alias-'))
mkdirSync(join(aliasProj, '.git'))
const aliasSeed = await drive([
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
  call(90, 'add_item', { project: aliasProj, title: 'Alias item', status: 'wip', agent: 'antigravity' }),
  call(91, 'add_fix', { project: aliasProj, title: 'Alias bug', problem: 'x.ts:1', agent: 'antigravity' }),
  call(92, 'add_milestone', { project: aliasProj, title: 'Alias phase', target: 'v9', agent: 'antigravity' })
])
const aliasItemId = json(byId(aliasSeed.replies, 90)).id
const aliasFixId = json(byId(aliasSeed.replies, 91)).id
const aliasMsId = json(byId(aliasSeed.replies, 92)).id
const aliasRun = await drive([
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
  call(93, 'set_item', { project: aliasProj, id: aliasItemId, status: 'done', agent: 'antigravity' }),
  call(94, 'mark_fixed', { project: aliasProj, id: aliasFixId, solution: 'guarded it' }),
  call(95, 'set_milestone', { project: aliasProj, id: aliasMsId, done: true })
])
ok('set_item accepts the bare `id` alias (not just item_id)',
  byId(aliasRun.replies, 93).result.isError !== true && json(byId(aliasRun.replies, 93)).status === 'done')
ok('mark_fixed accepts the bare `id` alias (not just fix_id)',
  byId(aliasRun.replies, 94).result.isError !== true && json(byId(aliasRun.replies, 94)).status === 'fixed')
ok('set_milestone accepts the bare `id` alias (not just milestone_id)',
  byId(aliasRun.replies, 95).result.isError !== true && json(byId(aliasRun.replies, 95)).done === true)
const aliasState = store.loadState(aliasProj)
ok('the id-alias writes landed in the real store',
  aliasState.items[0].status === 'done' && aliasState.fixes[0].status === 'fixed' && aliasState.roadmap[0].done === true)

// --- the work order: finish wip, then todo, then open fixes ----------------- //
// Asked for directly: "als iets in tracker in behandeling staat moet afgerond
// worden daarna verder met todo, en nieuwe bugs bij fixes onder open, later
// opgepakt". next_task is that order as a tool; get_board carries it as `next`.
const HOOKS = join(REPO, 'ide/agent-bundle/hooks')
const runHook = (script, payload) =>
  spawnSync(process.execPath, [join(HOOKS, script)], {
    input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    encoding: 'utf8'
  })
const statePathOf = (p) => join(p, '.planide', 'state.json')
const readBoard = (p) => JSON.parse(readFileSync(statePathOf(p), 'utf8'))
const writeBoard = (p, s) => writeFileSync(statePathOf(p), JSON.stringify(s, null, 2))

const qProj = mkdtempSync(join(tmpdir(), 'pulsar-queue-'))
mkdirSync(join(qProj, '.git'))
const qSeed = await drive([
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
  call(100, 'add_item', { project: qProj, title: 'Half-done login', status: 'wip', agent: 'claude' }),
  call(101, 'add_item', { project: qProj, title: 'Normal todo', status: 'todo' }),
  call(102, 'add_item', { project: qProj, title: 'Urgent todo', status: 'todo', priority: 'high' }),
  call(103, 'add_item', { project: qProj, title: 'Waiting on design', status: 'blocked' }),
  call(104, 'add_item', { project: qProj, title: 'Checkout flow', status: 'broken' })
])
const wipId = json(byId(qSeed.replies, 100)).id
const q1run = await drive([
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
  call(105, 'add_fix', { project: qProj, title: 'Cart total rounds wrong', problem: 'cart.ts:40', agent: 'claude' }),
  call(106, 'next_task', { project: qProj }),
  call(107, 'get_board', { project: qProj })
])
const loggedFix = json(byId(q1run.replies, 105))
const q1 = json(byId(q1run.replies, 106))
ok('a bug found mid-task is logged as open and the agent is told to stay on its wip',
  loggedFix.status === 'open' && /Fixes > Open/.test(loggedFix.next) && loggedFix.next.includes('Half-done login'))
ok('next_task: in-progress work comes first',
  q1.phase === 'finish' && q1.focus?.id === wipId && q1.focus.lane === 'in_progress')
ok('then todo, higher priority first, then oldest',
  q1.todo.map((t) => t.title).join('|') === 'Urgent todo|Normal todo')
ok('then open fixes, then broken items -- and blocked is never in the queue',
  q1.open_fixes[0]?.title === 'Cart total rounds wrong' && q1.broken[0]?.title === 'Checkout flow' &&
  q1.counts.blocked === 1 && q1.focus.title !== 'Waiting on design')
ok('get_board carries the same focus as `next`, so every agent that reads the board sees it',
  json(byId(q1run.replies, 107)).next?.focus?.id === wipId)

// Parallel agents: in-progress work another agent touched recently is theirs.
const q2 = json(byId((await drive([
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
  call(108, 'next_task', { project: qProj, agent: 'codex' })
])).replies, 108))
ok("another agent's fresh wip is not handed out twice -- it is listed as elsewhere",
  q2.focus?.title === 'Urgent todo' && q2.elsewhere.some((e) => e.id === wipId))

// Left over by an earlier session: 2 days idle comes back as unfinished work.
{
  const s = readBoard(qProj)
  s.items.find((i) => i.id === wipId).updated_at = new Date(Date.now() - 2 * 86400e3).toISOString().replace(/\.\d{3}Z$/, 'Z')
  writeBoard(qProj, s)
}
const q3run = await drive([
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
  call(109, 'next_task', { project: qProj, agent: 'codex', claim: true })
])
const q3 = json(byId(q3run.replies, 109))
ok('a wip left idle for days is resumed first, by whoever picks up',
  q3.claimed?.id === wipId && q3.claimed.taken_over_from === 'claude')
ok('and the take-over is recorded on the board and in activity',
  readBoard(qProj).items.find((i) => i.id === wipId).claimed_by === 'codex' &&
  readBoard(qProj).activity.some((a) => a.kind === 'item-claim' && a.who === 'codex'))

// claim starts the next todo: todo -> wip under the agent's name.
const claimProj = mkdtempSync(join(tmpdir(), 'pulsar-claim-'))
mkdirSync(join(claimProj, '.git'))
await drive([
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
  call(110, 'add_item', { project: claimProj, title: 'First todo' }),
  call(111, 'add_item', { project: claimProj, title: 'Second todo' })
])
const claimRun = await drive([
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
  call(112, 'next_task', { project: claimProj, agent: 'gemini', claim: true }),
  call(113, 'add_item', { project: claimProj, title: 'Side quest', status: 'wip', agent: 'gemini' })
])
const claimed = json(byId(claimRun.replies, 112))
ok('claim=true starts the first todo under the agent\'s name',
  claimed.claimed?.title === 'First todo' && claimed.claimed.to === 'wip' &&
  readBoard(claimProj).items.find((i) => i.title === 'First todo').claimed_by === 'gemini')
ok('and the queue it returns already reflects that', claimed.focus?.title === 'First todo' && claimed.phase === 'finish')
ok('starting a second wip while one is in hand warns: finish it first',
  /finish it first/i.test(json(byId(claimRun.replies, 113)).warning || ''))
{
  const s = store.loadState(claimProj)
  ok('the IDE store loads a claimed board and agrees it is in progress',
    s.items.find((i) => i.title === 'First todo').status === 'wip' && store.progress(s).counts.wip === 2)
}

// A peek never writes: the board file the IDE watches must not churn.
const fixOnly = mkdtempSync(join(tmpdir(), 'pulsar-fixonly-'))
mkdirSync(join(fixOnly, '.git'))
await drive([
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
  call(114, 'add_fix', { project: fixOnly, title: 'Only a bug left' })
])
const beforePeek = readFileSync(statePathOf(fixOnly), 'utf8')
const peekRun = await drive([
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
  call(115, 'next_task', { project: fixOnly, claim: true })
])
const peek = json(byId(peekRun.replies, 115))
ok('with only fixes left the fix queue is the focus', peek.phase === 'fixes' && peek.focus?.lane === 'fix')
ok('and claiming a fix writes nothing -- the board file is byte-identical',
  peek.claimed === null && readFileSync(statePathOf(fixOnly), 'utf8') === beforePeek)

// A protected item is the user's: claim never moves it, and never writes for it.
const lockedTodo = mkdtempSync(join(tmpdir(), 'pulsar-lockedtodo-'))
{
  const s = store.loadState(lockedTodo)
  const it = store.addItem(s, { title: 'Hands off', status: 'todo' })
  store.lockItem(s, it.id, true)
  store.saveState(lockedTodo, s)
}
const beforeLocked = readFileSync(statePathOf(lockedTodo), 'utf8')
const lockedClaim = json(byId((await drive([
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
  call(117, 'next_task', { project: lockedTodo, agent: 'codex', claim: true })
])).replies, 117))
ok('claim leaves a protected item alone, says why, and writes nothing',
  lockedClaim.claimed === null && /protected/.test(lockedClaim.note) &&
  readFileSync(statePathOf(lockedTodo), 'utf8') === beforeLocked)

// A regression is surfaced, not silently reordered around.
const regProj = mkdtempSync(join(tmpdir(), 'pulsar-reg-'))
mkdirSync(join(regProj, '.git'))
{
  const s = store.loadState(regProj)
  const it = store.addItem(s, { title: 'Payments', status: 'works' })
  store.lockItem(s, it.id, true)
  store.updateItem(s, it.id, { status: 'broken', claimed_by: 'codex' })
  store.addItem(s, { title: 'Next feature', status: 'todo' })
  store.saveState(regProj, s)
}
const reg = json(byId((await drive([
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
  call(116, 'next_task', { project: regProj })
])).replies, 116))
ok('a broken protected item comes back as an alert on top of the queue',
  reg.alerts.some((a) => a.includes('REGRESSION') && a.includes('Payments')) && reg.focus?.title === 'Next feature')

// --- the fix log: one bug, one entry --------------------------------------- //
const fixProj = mkdtempSync(join(tmpdir(), 'pulsar-fixdup-'))
mkdirSync(join(fixProj, '.git'))
const fd = await drive([
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
  call(120, 'add_fix', { project: fixProj, title: 'Login crash', problem: 'auth.ts:12 throws' }),
  call(121, 'add_fix', { project: fixProj, title: 'login crash!', problem: 'also on Safari' }),
  call(122, 'add_fix', { project: fixProj, title: 'login crash', problem: 'auth.ts:12 throws' })
])
const fd1 = json(byId(fd.replies, 120))
const fd2 = json(byId(fd.replies, 121))
const fixBoard = readBoard(fixProj)
ok('logging the same open bug again returns the entry already there',
  fd2.id === fd1.id && fd2.existing === true && json(byId(fd.replies, 122)).id === fd1.id)
ok('the board holds one open fix, with the new detail kept on it (and no repeat)',
  fixBoard.fixes.length === 1 &&
  fixBoard.fixes[0].problem === 'auth.ts:12 throws\nalso on Safari')
const fd3 = await drive([
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
  call(123, 'mark_fixed', { project: fixProj, fix_id: fd1.id }),
  call(124, 'add_fix', { project: fixProj, title: 'Login crash' }),
  call(125, 'mark_fixed', { project: fixProj })
])
ok('closing a fix with no solution still closes it, and says why that is a problem',
  json(byId(fd3.replies, 123)).status === 'fixed' && /no solution/i.test(json(byId(fd3.replies, 123)).warning || ''))
ok('a bug that comes back after being fixed is a new entry, not a silent merge into the closed one',
  json(byId(fd3.replies, 124)).id !== fd1.id && readBoard(fixProj).fixes.length === 2)
ok('mark_fixed with no id says which argument is missing',
  byId(fd3.replies, 125).result.isError === true && text(byId(fd3.replies, 125)).includes('fix_id is required'))
ok('the IDE store counts the deduplicated log the same way',
  store.progress(store.loadState(fixProj)).open_fixes === 1)

// --- titles outside ASCII are real titles ---------------------------------- //
// The old match erased every non-ASCII letter, so any two Cyrillic/CJK titles
// normalised to '' and "matched": the second add was silently dropped.
const uniProj = mkdtempSync(join(tmpdir(), 'pulsar-uni-'))
mkdirSync(join(uniProj, '.git'))
const uni = await drive([
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
  call(130, 'add_item', { project: uniProj, title: 'Исправить вход' }),
  call(131, 'add_item', { project: uniProj, title: 'Добавить поиск' }),
  call(132, 'add_item', { project: uniProj, title: '修复登录' }),
  call(133, 'add_item', { project: uniProj, title: 'исправить  вход!' }),
  call(134, 'add_item', { project: uniProj, title: 'Categorieën bijwerken' }),
  call(135, 'add_item', { project: uniProj, title: 'Categorien bijwerken' })
])
ok('two different non-Latin titles are two items, not one swallowed by the other',
  json(byId(uni.replies, 131)).existing !== true && json(byId(uni.replies, 132)).existing !== true)
ok('the same non-Latin title still deduplicates (case and punctuation ignored)',
  json(byId(uni.replies, 133)).existing === true && json(byId(uni.replies, 133)).id === json(byId(uni.replies, 130)).id)
ok('an accented letter is a letter, not a word break',
  json(byId(uni.replies, 135)).existing !== true && readBoard(uniProj).items.length === 5)

// --- the plan hook and sync_plan: one match, and done stays done ----------- //
const planHookProj = mkdtempSync(join(tmpdir(), 'pulsar-planhook-'))
mkdirSync(join(planHookProj, '.git'))
await drive([
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
  call(140, 'sync_plan', { project: planHookProj, todos: [{ content: 'Write tests.', status: 'pending' }] })
])
runHook('todo-sync.mjs', { tool_name: 'TodoWrite', cwd: planHookProj, tool_input: { todos: [{ content: 'Write tests', status: 'in_progress' }] } })
ok('the plan hook and sync_plan match a step the same way (no second row over a full stop)',
  readBoard(planHookProj).items.filter((i) => /write tests/i.test(i.title)).map((i) => i.status).join() === 'wip')

// Closed out to done by the agent, then confirmed by the user in the IDE.
runHook('todo-sync.mjs', { tool_name: 'TodoWrite', cwd: planHookProj, tool_input: { todos: [{ content: 'Write tests', status: 'completed' }] } })
{
  const s = store.loadState(planHookProj)
  const it = s.items.find((i) => /write tests/i.test(i.title))
  store.updateItem(s, it.id, { status: 'done', claimed_by: 'claude' })
  store.verifyItem(s, it.id, true)
  store.saveState(planHookProj, s)
}
// The agent re-sends its whole plan, finished step included, on the next change.
runHook('todo-sync.mjs', { tool_name: 'TodoWrite', cwd: planHookProj, tool_input: { todos: [
  { content: 'Write tests', status: 'completed' }, { content: 'Ship it', status: 'in_progress' }] } })
await drive([
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
  call(141, 'sync_plan', { project: planHookProj, todos: [{ content: 'Write tests', status: 'completed' }] })
])
{
  const it = readBoard(planHookProj).items.find((i) => /write tests/i.test(i.title))
  ok('a done step stays done when the plan re-sends it as completed (hook and sync_plan)', it.status === 'done')
  ok("and the user's own confirmation survives it", it.verified === true && it.verified_by === '')
}
// Work recurs: the same step started again after it was closed is a new row.
runHook('todo-sync.mjs', { tool_name: 'TodoWrite', cwd: planHookProj, tool_input: { todos: [{ content: 'Write tests', status: 'in_progress' }] } })
{
  const rows = readBoard(planHookProj).items.filter((i) => /write tests/i.test(i.title))
  ok('a closed step started again becomes a new row, and the closed one keeps its record',
    rows.length === 2 && rows.some((r) => r.status === 'done') && rows.some((r) => r.status === 'wip'))
}

// --- the resume brief a session starts with -------------------------------- //
const brief = runHook('resume-brief.mjs', { cwd: qProj, hook_event_name: 'SessionStart', source: 'resume' })
let briefOut = null
try {
  briefOut = JSON.parse(brief.stdout)
} catch {
  briefOut = null
}
const ctx = briefOut?.hookSpecificOutput?.additionalContext || ''
ok('resume brief: a tracked project gets a SessionStart additionalContext',
  brief.status === 0 && briefOut?.hookSpecificOutput?.hookEventName === 'SessionStart')
ok('resume brief: it names the work order and the item to finish first',
  ctx.includes('Work order') && /In progress -- finish first: "Half-done login"/.test(ctx))
ok('resume brief: then the todo list and the open fixes, in that order',
  ctx.indexOf('Next todo') > ctx.indexOf('In progress') && ctx.indexOf('Open fixes') > ctx.indexOf('Next todo') &&
  ctx.includes('Cart total rounds wrong'))
ok('resume brief: blocked is reported, never queued', /Blocked, waiting on someone.*: 1/.test(ctx))
const untracked = mkdtempSync(join(tmpdir(), 'pulsar-untracked-'))
mkdirSync(join(untracked, '.git'))
const quiet = runHook('resume-brief.mjs', { cwd: untracked })
ok('resume brief: an untracked repo gets nothing, and no board is created',
  quiet.status === 0 && quiet.stdout === '' && !existsSync(statePathOf(untracked)))
const cleanProj = mkdtempSync(join(tmpdir(), 'pulsar-clean-'))
{
  const s = store.loadState(cleanProj)
  store.addItem(s, { title: 'All shipped', status: 'done' })
  store.saveState(cleanProj, s)
}
ok('resume brief: a board with nothing open costs no context at all',
  runHook('resume-brief.mjs', { cwd: cleanProj }).stdout === '')
const garbage = runHook('resume-brief.mjs', '{not json')
ok('resume brief: a malformed payload never errors in front of the first prompt',
  garbage.status === 0 && garbage.stderr === '')

// --- auto-complete: what works is finished, no ticking off by hand --------- //
// "wat werkt mag als afgerond zijn, want ik ga niet handmatig dat doen". On by
// default; the user's own switch, which no agent tool can reach.
const acOn = mkdtempSync(join(tmpdir(), 'pulsar-acon-'))
mkdirSync(join(acOn, '.git'))
{
  // A board from before the switch: an agent's `works` left sitting there.
  const s = store.loadState(acOn)
  delete s.settings
  store.addItem(s, { title: 'Left in works by an old hook', status: 'works', claimedBy: 'codex' })
  store.addItem(s, { title: 'You chose works', status: 'works' })
  store.saveState(acOn, s)
}
const acRun = await drive([
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: { name: 'claude-code' } } },
  call(150, 'add_item', { project: acOn, title: 'Reported working on arrival', status: 'works', agent: 'gemini' }),
  call(151, 'sync_plan', { project: acOn, agent: 'claude', todos: [{ content: 'Plan step done', status: 'completed' }] }),
  call(152, 'add_item', { project: acOn, title: 'Will be set working' }),
  call(153, 'get_board', { project: acOn })
])
const acBoard0 = json(byId(acRun.replies, 153))
const willId = acBoard0.items.find((i) => i.title === 'Will be set working').id
const acSet = json(byId((await drive([
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: { name: 'claude-code' } } },
  call(154, 'set_item', { project: acOn, item_id: willId, status: 'works' })
])).replies, 154))
const acState = readBoard(acOn)
const acStatus = (t) => acState.items.find((i) => i.title === t)?.status
ok('auto-complete on: add_item works, a completed plan step and set_item works all land as done',
  acStatus('Reported working on arrival') === 'done' && acStatus('Plan step done') === 'done' &&
  acSet.status === 'done')
ok('set_item with no agent name is attributed to the client, never to you',
  acSet.verified === true && acSet.verified_by === 'claude-code')
ok('an agent works left on the board by an older route is closed out on the next write',
  acStatus('Left in works by an old hook') === 'done' &&
  acState.activity.some((a) => a.kind === 'auto-complete' && a.who === 'auto'))
ok('a works you chose yourself is left exactly where you put it', acStatus('You chose works') === 'works')
ok('get_board says the switch is on and counts what works as finished',
  acBoard0.progress.auto_complete === true && acBoard0.progress.unconfirmed === 0 &&
  acBoard0.progress.accepted === acBoard0.progress.counts.works + acBoard0.progress.counts.done)
ok('and "confirmed" still means confirmed by you: zero, nobody checked anything',
  acBoard0.progress.confirmed === 0)
{
  const s = store.loadState(acOn)
  ok('the IDE store reads the same board the same way',
    store.progress(s).accepted === store.progress(s).done && store.progress(s).unconfirmed === 0)
}

const acOff = mkdtempSync(join(tmpdir(), 'pulsar-acoff-'))
mkdirSync(join(acOff, '.git'))
{
  const s = store.loadState(acOff)
  store.setAutoComplete(s, false)
  store.addItem(s, { title: 'Old works', status: 'works', claimedBy: 'codex' })
  store.saveState(acOff, s)
}
await drive([
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
  call(160, 'add_item', { project: acOff, title: 'Off: reported working', status: 'works', agent: 'gemini' }),
  call(161, 'sync_plan', { project: acOff, agent: 'claude', todos: [{ content: 'Off: plan step', status: 'completed' }] })
])
runHook('todo-sync.mjs', { tool_name: 'TodoWrite', cwd: acOff, tool_input: { todos: [{ content: 'Off: hook step', status: 'completed' }] } })
{
  const st = readBoard(acOff)
  const status = (t) => st.items.find((i) => i.title === t)?.status
  ok('auto-complete off: every route leaves agent work in works, for you to check',
    status('Off: reported working') === 'works' && status('Off: plan step') === 'works' &&
    status('Off: hook step') === 'works' && status('Old works') === 'works')
  const offBoard = json(byId((await drive([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
    call(162, 'get_board', { project: acOff })
  ])).replies, 162))
  ok('and the rollup counts it as claimed, not finished', offBoard.progress.auto_complete === false &&
    offBoard.progress.accepted === 0 && offBoard.progress.unconfirmed === 4)
}

// The switch is the user's: nothing an agent can send reaches it.
{
  const listed = byId((await drive([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' }
  ])).replies, 2).result.tools
  ok('no agent tool offers a way to change the user\'s settings',
    !listed.some((t) => /setting|auto_?complete/i.test(t.name) ||
      Object.keys(t.inputSchema?.properties ?? {}).some((k) => /setting|auto_?complete/i.test(k))))
  const before = readBoard(acOff).settings
  await drive([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
    call(163, 'set_item', { project: acOff, item_id: readBoard(acOff).items[0].id, status: 'wip', settings: { auto_complete: true }, auto_complete: true }),
    call(164, 'add_item', { project: acOff, title: 'Sneaky switch', settings: { auto_complete: true } })
  ])
  ok('and a payload smuggling one in changes nothing',
    JSON.stringify(readBoard(acOff).settings) === JSON.stringify(before) && readBoard(acOff).settings.auto_complete === false)
}

// --- parity: the IDE's own queue and sweep are the agents' ----------------- //
// store.ts carries a TypeScript port of work-queue.mjs for the panel. Same
// boards, same clock, byte-for-byte the same answer -- or they have drifted.
{
  const wq = await import(pathToFileURL(join(REPO, 'ide/agent-bundle/tracker/mcp/work-queue.mjs')).href)
  const now = Date.now()
  const boards = [qProj, claimProj, regProj, fixOnly, uniProj, lockedTodo, acOn, acOff].map((p) => readBoard(p))
  const agents = ['', 'codex', 'claude', 'gemini']
  let same = true
  for (const b of boards) {
    for (const agent of agents) {
      const a = JSON.stringify(wq.workQueue(b, { agent, now }))
      const t = JSON.stringify(store.workQueue(b, { agent, now }))
      if (a !== t) {
        same = false
        console.log('    queue drift on', b.path, 'agent', agent)
      }
    }
  }
  ok('the IDE queue and the agents\' next_task agree on every board, for every agent', same)
  ok('and they agree on the work order text agents are told', wq.WORK_ORDER === store.WORK_ORDER && wq.STALE_HOURS === store.STALE_HOURS)
  const fixture = {
    settings: { auto_complete: true },
    items: [
      { id: 'a', title: 'agent works', status: 'works', claimed_by: 'x', locked: false, activity: [] },
      { id: 'b', title: 'your works', status: 'works', claimed_by: '', locked: false },
      { id: 'c', title: 'locked works', status: 'works', claimed_by: 'x', locked: true },
      { id: 'd', title: 'agent wip', status: 'wip', claimed_by: 'x', locked: false }
    ],
    activity: []
  }
  const js = structuredClone(fixture)
  const ts = structuredClone(fixture)
  const closedJs = wq.closeOutWorking(js).map((i) => i.id).join()
  const closedTs = store.closeOutWorking(ts).map((i) => i.id).join()
  ok('the sweep closes out exactly the same items on both sides',
    closedJs === 'a' && closedTs === 'a' &&
    JSON.stringify(js.items.map((i) => i.status)) === JSON.stringify(ts.items.map((i) => i.status)))
  ok('and the switch reads the same way, including a board with no settings at all',
    wq.autoComplete({}) === store.autoComplete({}) && wq.autoComplete({ settings: { auto_complete: false } }) === false &&
    store.autoComplete({ settings: { auto_complete: false } }) === false)
}

// --- a plan's own steps leave the board when the plan drops them ----------- //
// "todo gaat nooit omlaag waardoor het oneindig is": every plan step became a
// row and none ever left. Now a plan takes back the OPEN rows it created itself
// and has since dropped -- never a row that was on the board first, never one
// the user made theirs, never finished work, never another session's.
{
  const rp = mkdtempSync(join(tmpdir(), 'pulsar-retire-'))
  mkdirSync(join(rp, '.git'))
  const todo = (session, todos, extra = {}) =>
    runHook('todo-sync.mjs', { tool_name: 'TodoWrite', session_id: session, cwd: rp, tool_input: { todos }, ...extra })
  const titles = () => readBoard(rp).items.map((i) => `${i.title}:${i.status}`).sort().join(',')

  // A row the board had before any plan touched it.
  await drive([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
    call(400, 'add_item', { project: rp, title: 'Board item first' })
  ])
  todo('S1', [
    { content: 'Step A', status: 'in_progress' },
    { content: 'Step B', status: 'pending' },
    { content: 'Step C', status: 'pending' },
    { content: 'Board item first', status: 'pending' }
  ])
  ok('retire: a plan lands as before, its new rows stamped with their plan',
    titles() === 'Board item first:todo,Step A:wip,Step B:todo,Step C:todo' &&
    readBoard(rp).items.filter((i) => i.plan_key === 'S1').length === 3 &&
    !readBoard(rp).items.find((i) => i.title === 'Board item first').plan_key)
  ok('retire: the plan hook names the agent instead of "agent"',
    readBoard(rp).items.find((i) => i.title === 'Step A').claimed_by === 'Claude Code')

  // The user makes Step C theirs in the IDE.
  {
    const s = store.loadState(rp)
    store.updateItem(s, s.items.find((i) => i.title === 'Step C').id, { notes: 'keep this one' })
    store.saveState(rp, s)
  }
  // A subagent in the same session has a plan of its own.
  todo('S1', [{ content: 'Sub step', status: 'in_progress' }], { agent_id: 'sub-1', agent_type: 'pulse-frontend' })
  // Another session's plan never touches S1's rows.
  todo('S2', [{ content: 'Other session step', status: 'pending' }])

  // S1 re-plans: A finished, B re-worded, C and the board item dropped.
  todo('S1', [
    { content: 'Step A', status: 'completed' },
    { content: 'Step B, reworded', status: 'in_progress' }
  ])
  const after = titles()
  ok('retire: the open steps this plan created and dropped leave the board',
    !after.includes('Step B:') && after.includes('Step B, reworded:wip'))
  ok('retire: finished work stays, as done',
    after.includes('Step A:done'))
  ok('retire: a row that was on the board first stays when the plan drops it',
    after.includes('Board item first:todo'))
  ok('retire: a row the user annotated is theirs and stays',
    after.includes('Step C:todo') && !readBoard(rp).items.find((i) => i.title === 'Step C').plan_key)
  ok("retire: a subagent's plan and another session's plan are untouched",
    after.includes('Sub step:wip') && after.includes('Other session step:todo') &&
    readBoard(rp).items.find((i) => i.title === 'Sub step').claimed_by === 'pulse-frontend')
  ok('retire: the activity log says what left and why',
    readBoard(rp).activity.some((a) => /dropped from the plan/.test(a.text) && /Step B/.test(a.text)))

  // A plan with no session (an older agent, a hand-run hook) only adds and moves.
  todo('', [{ content: 'Unkeyed', status: 'pending' }])
  todo('', [{ content: 'Unkeyed 2', status: 'pending' }])
  ok('retire: without a session nothing is ever retired', titles().includes('Unkeyed:todo'))

  // sync_plan: one server process is one agent session.
  const sp = await drive([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
    call(401, 'sync_plan', { project: rp, agent: 'antigravity', todos: [{ content: 'MCP one', status: 'pending' }, { content: 'MCP two', status: 'pending' }] }),
    call(402, 'sync_plan', { project: rp, agent: 'antigravity', todos: [{ content: 'MCP one', status: 'in_progress' }] })
  ])
  ok('retire: sync_plan takes back what the same session dropped, and says so',
    json(byId(sp.replies, 402)).dropped === 1 && titles().includes('MCP one:wip') && !titles().includes('MCP two'))
  const sp2 = await drive([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
    call(403, 'sync_plan', { project: rp, agent: 'antigravity', todos: [{ content: 'Something else', status: 'pending' }] })
  ])
  ok("retire: a new session's sync_plan leaves the last session's open work for the queue",
    !json(byId(sp2.replies, 403)).dropped && titles().includes('MCP one:wip'))
}

// --- autopilot: the next item instead of the end of the turn --------------- //
// "als ik niet vraag pak wat in behandeling is op, doet hij het niet". The
// keep-going hook marks the board at each prompt and, when a turn that worked
// the board ends while work is left, blocks the stop with the next item.
{
  const ap = mkdtempSync(join(tmpdir(), 'pulsar-autopilot-'))
  mkdirSync(join(ap, '.git'))
  await drive([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
    call(410, 'add_item', { project: ap, title: 'Left over work', status: 'wip' }),
    call(411, 'add_item', { project: ap, title: 'Queued work' })
  ])
  const go = (event, extra = {}) => {
    const r = runHook('keep-going.mjs', { hook_event_name: event, session_id: 'AP1', cwd: ap, ...extra })
    let out = null
    try {
      out = r.stdout.trim() ? JSON.parse(r.stdout) : null
    } catch {
      out = { unparsable: r.stdout }
    }
    return { status: r.status, out }
  }
  const sessions = () => JSON.parse(readFileSync(join(ap, '.planide', 'sessions.json'), 'utf8'))

  const q1 = go('UserPromptSubmit', { prompt: 'what does the header component do?' })
  ok('autopilot: an ordinary prompt adds nothing to the context, and marks the board',
    q1.status === 0 && q1.out === null && sessions().AP1?.mark && sessions().AP1.worked === false)
  const s1 = go('Stop', { last_assistant_message: 'It renders the title bar.' })
  ok('autopilot: a turn that never touched the board ends normally (a chat is not hijacked)',
    s1.out === null)

  go('UserPromptSubmit', { prompt: 'build the footer' })
  runHook('todo-sync.mjs', { tool_name: 'TodoWrite', session_id: 'AP1', cwd: ap, tool_input: { todos: [
    { content: 'Build the footer', status: 'completed' }] } })
  ok('autopilot: the plan hook records that this session worked the board', sessions().AP1.worked === true)
  const s2 = go('Stop', { last_assistant_message: 'Footer is done.' })
  ok('autopilot: when that turn ends, the stop is blocked with the next item -- in progress first',
    s2.out?.decision === 'block' && /"Left over work"/.test(s2.out.reason) && /in progress/.test(s2.out.reason))
  ok('autopilot: the answer is exactly Codex\'s Stop shape (deny_unknown_fields: decision + reason only)',
    JSON.stringify(Object.keys(s2.out).sort()) === '["decision","reason"]')
  const s3 = go('Stop', { last_assistant_message: 'Looked at it.' })
  ok('autopilot: stopping again with nothing moved is let through (no loop)', s3.out === null)

  // The agent finishes the left-over item: the board moved, so the next one comes.
  {
    const s = store.loadState(ap)
    store.updateItem(s, s.items.find((i) => i.title === 'Left over work').id, { status: 'done', claimed_by: 'Claude Code' })
    store.saveState(ap, s)
  }
  const s4 = go('Stop', { last_assistant_message: 'Left-over work finished.' })
  ok('autopilot: progress since the last push earns the next push -- the todo now',
    s4.out?.decision === 'block' && /"Queued work"/.test(s4.out.reason) && /next todo/.test(s4.out.reason))

  // A turn that ends on a question to the user is theirs to answer.
  {
    const s = store.loadState(ap)
    store.addItem(s, { title: 'One more' })
    store.saveState(ap, s)
  }
  const s5 = go('Stop', { last_assistant_message: 'Should the footer link to the docs or the blog?' })
  ok('autopilot: never pushes past a question to the user', s5.out === null)

  // Gemini CLI / Qwen Code: the same thing under their event names.
  const g1 = go('BeforeAgent', { prompt: 'ga door' })
  ok('autopilot: a bare "ga door" is answered with the item to continue with (Gemini BeforeAgent)',
    g1.out?.hookSpecificOutput?.hookEventName === 'BeforeAgent' &&
    /The user means: work the board/.test(g1.out.hookSpecificOutput.additionalContext) &&
    /"Queued work"/.test(g1.out.hookSpecificOutput.additionalContext))
  {
    const s = store.loadState(ap)
    store.updateItem(s, s.items.find((i) => i.title === 'Queued work').id, { status: 'wip', claimed_by: 'Gemini CLI' })
    store.saveState(ap, s)
  }
  const g2 = go('AfterAgent', { prompt_response: 'Started on it.' })
  ok('autopilot: Gemini AfterAgent gets the same block, after a "carry on" turn that moved the board',
    g2.out?.decision === 'block' && /"Queued work"/.test(g2.out.reason))

  // The per-turn limit.
  {
    const all = sessions()
    all.AP1.pushes = 12
    all.AP1.mark = 'stale'
    writeFileSync(join(ap, '.planide', 'sessions.json'), JSON.stringify(all))
  }
  ok('autopilot: a turn gets at most AUTOPILOT_MAX continuations', go('Stop', { last_assistant_message: 'ok' }).out === null)

  // The user's switch.
  go('UserPromptSubmit', { prompt: 'continue' })
  {
    const s = store.loadState(ap)
    store.setAutopilot(s, false)
    store.saveState(ap, s)
  }
  const off = go('UserPromptSubmit', { prompt: 'ga door' })
  {
    const all = sessions()
    all.AP1.mark = 'stale'
    writeFileSync(join(ap, '.planide', 'sessions.json'), JSON.stringify(all))
  }
  ok('autopilot: off means off -- no context on "ga door", no push at the stop',
    off.out === null && go('Stop', { last_assistant_message: 'done' }).out === null)

  // Agents with no stop hook (Antigravity, Cursor, opencode): set_item hands over the next item.
  {
    const s = store.loadState(ap)
    store.setAutopilot(s, true)
    store.saveState(ap, s)
  }
  const one = readBoard(ap).items.find((i) => i.title === 'One more')
  const si = await drive([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
    call(412, 'set_item', { project: ap, id: readBoard(ap).items.find((i) => i.title === 'Queued work').id, status: 'done', agent: 'antigravity' })
  ])
  ok('autopilot: set_item done answers with the next item for agents without hooks',
    /"One more"/.test(json(byId(si.replies, 412)).next || '') && Boolean(one))
  ok('autopilot: an untracked project, or no session id, is left alone',
    runHook('keep-going.mjs', { hook_event_name: 'Stop', session_id: 'X', cwd: mkdtempSync(join(tmpdir(), 'pulsar-untracked-ap-')) }).stdout === '' &&
    runHook('keep-going.mjs', { hook_event_name: 'Stop', cwd: ap }).stdout === '')
}

// --- the continue cue: short "carry on" prompts only ----------------------- //
{
  const wq = await import(pathToFileURL(join(REPO, 'ide/agent-bundle/tracker/mcp/work-queue.mjs')).href)
  const yes = ['ga door', 'Ga verder.', 'ok, top, ga maar door!', 'Continue from where you left off.', 'pak het op', 'next']
  const no = ['ga door met de login-fix en ook de tests', 'wat doet deze functie?', 'top maak zo release', '']
  ok('continue cue: "ga door" / "continue" count, a prompt naming its own work does not',
    yes.every((p) => wq.isContinuePrompt(p)) && no.every((p) => !wq.isContinuePrompt(p)))
  ok('autopilot switch: missing reads as on, the same on the agent side and in the IDE',
    wq.autopilot({}) === true && store.autopilot({}) === true &&
    wq.autopilot({ settings: { autopilot: false } }) === false && store.autopilot({ settings: { autopilot: false } }) === false)
}

// --- docs: one docs/ folder, and one document when the project is done ----- //
// "in plaats van heel veel md-bestanden: bij bestaande alles in een docs-map,
// in de toekomst alleen daar, en zodra het af is één duidelijk document".
{
  const dp = mkdtempSync(join(tmpdir(), 'pulsar-docs-'))
  mkdirSync(join(dp, '.git'))
  mkdirSync(join(dp, 'src'))
  writeFileSync(join(dp, 'src', 'app.ts'), 'export {}\n')
  writeFileSync(join(dp, 'README.md'), '# App\nSee [the plan](PLAN.md).\n')
  writeFileSync(join(dp, 'AGENTS.md'), '# agents\n')
  writeFileSync(join(dp, 'CHANGELOG.md'), '# changes\n')
  writeFileSync(join(dp, 'PLAN.md'), '# Plan\nStart in [app](src/app.ts).\n')
  writeFileSync(join(dp, 'IMPLEMENTATION_SUMMARY.md'), '# Summary\n')
  await drive([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
    call(420, 'add_item', { project: dp, title: 'Only item', status: 'done' })
  ])
  const sb = runHook('resume-brief.mjs', { cwd: dp, hook_event_name: 'SessionStart', source: 'startup' })
  let sbCtx = ''
  try {
    sbCtx = JSON.parse(sb.stdout).hookSpecificOutput.additionalContext
  } catch {
    sbCtx = ''
  }
  ok('docs: an existing project\'s loose docs move into docs/ when a session starts',
    existsSync(join(dp, 'docs', 'PLAN.md')) && existsSync(join(dp, 'docs', 'IMPLEMENTATION_SUMMARY.md')) &&
    !existsSync(join(dp, 'PLAN.md')) && !existsSync(join(dp, 'IMPLEMENTATION_SUMMARY.md')))
  ok('docs: README, AGENTS.md and CHANGELOG stay at the root',
    ['README.md', 'AGENTS.md', 'CHANGELOG.md'].every((f) => existsSync(join(dp, f))))
  ok('docs: links still work both ways after the move',
    readFileSync(join(dp, 'docs', 'PLAN.md'), 'utf8').includes('](../src/app.ts)') &&
    readFileSync(join(dp, 'README.md'), 'utf8').includes('](docs/PLAN.md)'))
  ok('docs: the session is told what moved, and the board\'s activity says so too',
    /moved 2 loose doc\(s\) into docs\//.test(sbCtx) && readBoard(dp).activity.some((a) => a.kind === 'docs'))

  // Future writes: a new loose doc at the root is refused with where it goes.
  const guard = (payload) => {
    const r = runHook('docs-guard.mjs', { cwd: dp, ...payload })
    try {
      return r.stdout.trim() ? JSON.parse(r.stdout) : null
    } catch {
      return { unparsable: r.stdout }
    }
  }
  const deny = guard({ hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: join(dp, 'NOTES.md'), content: 'x' } })
  ok('docs guard: Claude Code writing a new loose doc at the root is denied, with the docs/ path',
    deny?.hookSpecificOutput?.permissionDecision === 'deny' &&
    deny.hookSpecificOutput.permissionDecisionReason.includes(join(dp, 'docs', 'NOTES.md')))
  ok('docs guard: docs/, README and existing files are let through',
    guard({ hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: join(dp, 'docs', 'NOTES.md') } }) === null &&
    guard({ hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: join(dp, 'CONTRIBUTING.md') } }) === null &&
    guard({ hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: join(dp, 'src', 'notes.md') } }) === null &&
    guard({ hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: join(dp, 'README.md') } }) === null)
  const gDeny = guard({ hook_event_name: 'BeforeTool', tool_name: 'write_file', tool_input: { file_path: 'ROADMAP_NOTES.md' } })
  ok('docs guard: Gemini CLI gets its own deny shape', gDeny?.decision === 'deny' && /docs\//.test(gDeny.reason))

  // A loose doc that got through anyway (Codex writes via apply_patch) moves at the next prompt.
  writeFileSync(join(dp, 'CODEX_NOTES.md'), '# from codex\n')
  const pr = runHook('keep-going.mjs', { hook_event_name: 'UserPromptSubmit', session_id: 'DOC1', cwd: dp, prompt: 'build the export' })
  let prCtx = ''
  try {
    prCtx = JSON.parse(pr.stdout).hookSpecificOutput.additionalContext
  } catch {
    prCtx = ''
  }
  ok('docs: one written at the root anyway moves at the next prompt, and the agent hears where',
    existsSync(join(dp, 'docs', 'CODEX_NOTES.md')) && /CODEX_NOTES\.md -> docs\/CODEX_NOTES\.md/.test(prCtx))

  // The project is done: the last item is one document out of all of them.
  runHook('todo-sync.mjs', { tool_name: 'TodoWrite', session_id: 'DOC1', cwd: dp, tool_input: { todos: [
    { content: 'Build the export', status: 'completed' }] } })
  const end = JSON.parse(runHook('keep-going.mjs', { hook_event_name: 'Stop', session_id: 'DOC1', cwd: dp, last_assistant_message: 'Export done.' }).stdout || '{}')
  const bundle = readBoard(dp).items.find((i) => /Bundle the docs/.test(i.title))
  ok('docs: a working turn ending on a clear board gets the bundle item -- read them all, write one',
    end.decision === 'block' && /Bundle the docs/.test(end.reason) && /docs\/README\.md/.test(end.reason) &&
    /archive/.test(end.reason) && bundle?.status === 'todo')
  // Closed without bundling: not asked again for the same set of documents.
  {
    const s = store.loadState(dp)
    store.updateItem(s, bundle.id, { status: 'done', claimed_by: 'Claude Code' })
    store.saveState(dp, s)
  }
  const again = runHook('keep-going.mjs', { hook_event_name: 'Stop', session_id: 'DOC1', cwd: dp, last_assistant_message: 'ok' })
  ok('docs: the same set of documents is never asked for twice',
    readBoard(dp).items.filter((i) => /Bundle the docs/.test(i.title)).length === 1 && again.stdout === '')

  // Agents with no hooks: get_board tidies too.
  writeFileSync(join(dp, 'ANTIGRAVITY_PLAN.md'), '# plan\n')
  const gb = await drive([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
    call(421, 'get_board', { project: dp })
  ])
  ok('docs: get_board moves loose docs for agents without hooks, and says so',
    /ANTIGRAVITY_PLAN\.md/.test(json(byId(gb.replies, 421)).docs || '') && existsSync(join(dp, 'docs', 'ANTIGRAVITY_PLAN.md')))
  const dt = await import(pathToFileURL(join(REPO, 'ide/agent-bundle/tracker/mcp/docs-tidy.mjs')).href)
  const notProject = mkdtempSync(join(tmpdir(), 'pulsar-notproj-'))
  writeFileSync(join(notProject, 'NOTES.md'), 'x')
  ok('docs: a folder that is not a project is never swept',
    dt.sweepDocs(notProject).length === 0 && existsSync(join(notProject, 'NOTES.md')))
}

console.log(`\nPASS=${pass} FAIL=${fail}`)
process.exit(fail ? 1 : 0)
