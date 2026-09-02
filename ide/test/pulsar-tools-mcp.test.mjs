/**
 * pulsar-tools over the real MCP stdio protocol.
 *
 * The team-lead files already told agents to call these tools; the server they
 * named was never shipped or registered, so on Codex or Cursor the instruction
 * pointed at nothing. This drives the actual binary the way an agent does.
 *
 * The routing cases are the interesting half. A first version scored raw term
 * frequency over the whole team file and got 4 of 7 wrong -- a 100-agent sector
 * team beats a focused one on volume alone. These pin the behaviour of the
 * algorithm ported from ThePunisher-Agent's router.py: sublinear TF so
 * repetition cannot carry a team, and a bonus for a query word that IS the
 * team's own name, gated to near-unique names so "engineering" does not tilt
 * everything.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SERVER = join(HERE, '..', 'agent-bundle', 'tracker', 'mcp', 'pulsar-tools-mcp.mjs')

let pass = 0
let fail = 0
const ok = (n, c) => (c ? (pass++, console.log('  PASS ' + n)) : (fail++, console.log('  FAIL ' + n)))

function drive(frames) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SERVER], { stdio: ['pipe', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.on('data', (d) => (out += d))
    child.on('error', reject)
    child.on('close', () =>
      resolve(out.split('\n').filter(Boolean).map((l) => JSON.parse(l)))
    )
    for (const f of frames) child.stdin.write(JSON.stringify(f) + '\n')
    child.stdin.end()
    setTimeout(() => child.kill(), 20000).unref?.()
  })
}
const call = (id, name, args) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } })
const byId = (rs, id) => rs.find((r) => r.id === id)
const json = (r) => JSON.parse(r.result.content[0].text)

// --- handshake and surface -------------------------------------------------- //
const hs = await drive([
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2026-06-18' } },
  { jsonrpc: '2.0', method: 'notifications/initialized' },
  { jsonrpc: '2.0', id: 2, method: 'tools/list' }
])
ok('it identifies itself as pulsar-tools', byId(hs, 1).result.serverInfo.name === 'pulsar-tools')
ok('it echoes the protocol version the client asked for',
  byId(hs, 1).result.protocolVersion === '2026-06-18')
const names = byId(hs, 2).result.tools.map((t) => t.name).sort()
ok('it offers exactly the tools the agents are told to call',
  JSON.stringify(names) === JSON.stringify(['check_anti_loop', 'clear_anti_loop', 're_triage', 'record_anti_loop_failure', 'record_solution', 'route_task']))
ok('an initialized notification is never answered', !hs.some((r) => r.id === undefined && r.result))

// --- routing: the cases the first implementation got wrong ------------------ //
// Every expectation here was checked against the real roster before being
// written down, not assumed from the team's name.
const ROUTES = [
  ['write unit tests for this react component', 'Testing & Quality Assurance'],
  ['debug why this api keeps crashing', 'Debug & Diagnosis'],
  ['reverse engineer this packed binary', 'Reverse Engineering Command'],
  ['review this pull request for bugs', 'Code Review & Quality'],
  ['brainstorm three architectures for a chat app', 'Brainstorm & Ideation'],
  ['set up a ci pipeline and deploy to kubernetes', 'DevOps & Automation']
]
const routeFrames = [{ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }]
ROUTES.forEach(([q], i) => routeFrames.push(call(100 + i, 'route_task', { query: q })))
const routed = await drive(routeFrames)
ROUTES.forEach(([q, expected], i) => {
  const r = json(byId(routed, 100 + i))
  const top = r.matches[0]?.team
  ok(`routes "${q.slice(0, 38)}…" to ${expected}`, top === expected)
})
const withAgents = json(byId(routed, 102))
ok('and names real specialists inside the matched team, not just the team',
  Array.isArray(withAgents.matches[0]?.agents) && withAgents.matches[0].agents.length > 0 &&
  typeof withAgents.matches[0].agents[0].name === 'string')

const nonsense = await drive([
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
  call(20, 'route_task', { query: 'the and of to with' })
])
ok('a query of nothing but stopwords routes nowhere rather than guessing',
  json(byId(nonsense, 20)).matches.length === 0)

// --- anti-loop -------------------------------------------------------------- //
const proj = mkdtempSync(join(tmpdir(), 'pulsar-loop-'))
const loop = await drive([
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
  call(30, 'check_anti_loop', { approach: 'patch the loader in place', cwd: proj }),
  call(31, 'record_anti_loop_failure', { problem: 'crash on boot', approach: 'patch the loader in place', error: 'segfault', cwd: proj }),
  call(32, 'check_anti_loop', { approach: 'patch the loader in place', cwd: proj }),
  call(33, 'check_anti_loop', { approach: 'Patch  The  Loader  In  Place', cwd: proj }),
  call(34, 'check_anti_loop', { approach: 'rebuild from source', cwd: proj }),
  call(35, 'record_anti_loop_failure', { problem: 'crash on boot', approach: 'patch the loader in place', error: 'again', cwd: proj }),
  call(37, 'check_anti_loop', { approach: 'patch the loader in place', cwd: proj }),
  call(36, 'check_anti_loop', { cwd: proj })
])
ok('a novel approach is not blocked', json(byId(loop, 30)).blocked === false)
ok('recording a failure reports it was written', json(byId(loop, 31)).recorded === true)
// One failure is not a loop: it warns and lets the work proceed. Refusing on a
// single failure halted work that would have succeeded once its cause was fixed.
ok('one failure warns rather than blocks',
  json(byId(loop, 32)).blocked === false && typeof json(byId(loop, 32)).warning === 'string')
ok('the second failure of the same approach is what blocks it',
  json(byId(loop, 37)).blocked === true && json(byId(loop, 37)).attempts === 2)
ok('a reworded repeat is recognised as the same approach -- spacing and case are not a new idea',
  json(byId(loop, 33)).attempts >= 1)
ok('an unrelated approach stays open', json(byId(loop, 34)).blocked === false)
ok('a repeat is counted rather than discarded -- the count is what escalates',
  json(byId(loop, 35)).recorded === false && json(byId(loop, 35)).attempts === 2 &&
  json(byId(loop, 35)).blocking === true && json(byId(loop, 35)).total === 1)
ok('a missing required argument is a correctable tool error, not a crash',
  byId(loop, 36).result.isError === true)

const registry = join(proj, '.thepunisher', 'failed-registry.json')
ok('it writes the same registry file the CLI anti-loop uses', existsSync(registry))
const reg = JSON.parse(readFileSync(registry, 'utf8'))
ok('with the shape that file is expected to have',
  Array.isArray(reg.failed) && reg.failed.length === 1 && typeof reg.failed[0].at === 'string' &&
  reg.failed[0].count === 2)

// Clearing gets its own project: it empties the registry, which would pull the
// file-shape assertions above out from under themselves.
const cleared = mkdtempSync(join(tmpdir(), 'pulsar-clear-'))
const clr = await drive([
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
  call(60, 'record_anti_loop_failure', { problem: 'p', approach: 'rewrite the parser by hand', error: 'e', cwd: cleared }),
  call(61, 'record_anti_loop_failure', { problem: 'p', approach: 'rewrite the parser by hand', error: 'e', cwd: cleared }),
  call(62, 'check_anti_loop', { approach: 'rewrite the parser by hand', cwd: cleared }),
  call(63, 'clear_anti_loop', { approach: 'rewrite the parser by hand', cwd: cleared }),
  call(64, 'check_anti_loop', { approach: 'rewrite the parser by hand', cwd: cleared })
])
ok('a blocked approach can be cleared once its cause is fixed',
  json(byId(clr, 62)).blocked === true &&
  json(byId(clr, 63)).cleared === 1 &&
  json(byId(clr, 64)).blocked === false)

// --- re_triage -------------------------------------------------------------- //
const triage = await drive([
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
  call(40, 're_triage', { binary_path: join(tmpdir(), 'definitely-not-here-' + Date.now()) }),
  call(41, 're_triage', {})
])
const t40 = byId(triage, 40)
ok('a binary that is not there is reported, never thrown',
  t40.result.isError === true || json(t40).ok === false)
ok('a missing path is a correctable tool error', byId(triage, 41).result.isError === true)

// --- the server survives bad input ------------------------------------------ //
const survived = await drive([
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
  call(50, 'no_such_tool', {}),
  { jsonrpc: '2.0', id: 51, method: 'ping' }
])
ok('an unknown tool is a protocol error', Boolean(byId(survived, 50).error))
ok('and the server keeps serving afterwards', Boolean(byId(survived, 51)))

// --- churn on one problem, not just a repeated approach --------------------- //
// The rest of the anti-loop only catches a REPEAT of one approach, so an agent
// that keeps inventing new ones for the same broken thing was never stopped --
// it just churned, which is the loop people actually notice. Four distinct dead
// ends on one problem now says so and sends it back to the user.
const churn = mkdtempSync(join(tmpdir(), 'pulsar-churn-'))
const P = 'login redirect loops forever'
const churnReplies = await drive([
  call(70, 'record_anti_loop_failure', { problem: P, approach: 'clear the session cookie on mount', error: 'still loops', cwd: churn }),
  call(71, 'record_anti_loop_failure', { problem: P, approach: 'add a guard on the router beforeEach hook', error: 'still loops', cwd: churn }),
  call(72, 'record_anti_loop_failure', { problem: P, approach: 'disable the auth middleware for the login route', error: 'still loops', cwd: churn }),
  call(73, 'record_anti_loop_failure', { problem: P, approach: 'return early when the token is absent', error: 'still loops', cwd: churn }),
  call(74, 'check_anti_loop', { problem: P, approach: 'rewrite the whole auth layer from scratch', cwd: churn }),
  call(75, 'check_anti_loop', { problem: 'csv export drops the header row', approach: 'write the header before the rows', cwd: churn })
])
const j = (id) => JSON.parse(byId(churnReplies, id).result.content[0].text)
ok('three dead ends is still ordinary problem-solving, not a loop', j(72).escalate === undefined)
ok('the fourth distinct failure escalates at record time',
   j(73).escalate === true && j(73).deadEnds === 4)
ok('a brand-new fifth approach is escalated instead of waved through',
   j(74).escalate === true && j(74).blocked === false && j(74).deadEnds === 4)
ok('and it says to go back to the user rather than propose another',
   /ask|user/i.test(String(j(74).escalation)))
ok('an unrelated problem in the same project is untouched',
   j(75).escalate === undefined && j(75).blocked === false)

// --- what was solved stays solved ------------------------------------------ //
// The registry could only ever say "do not do that again". It could not say
// "this was already fixed, here is how", so a later session re-solved settled
// work and sometimes undid it. Asked for directly: remember the fixes too.
const solvedDir = mkdtempSync(join(tmpdir(), 'pulsar-solved-'))
const SP = 'session cookie is dropped on refresh'
const solvedReplies = await drive([
  call(80, 'record_anti_loop_failure', { problem: SP, approach: 'widen the cookie max-age setting', error: 'still dropped', cwd: solvedDir }),
  call(81, 'record_anti_loop_failure', { problem: SP, approach: 'widen the cookie max-age setting', error: 'still dropped', cwd: solvedDir }),
  call(82, 'check_anti_loop', { problem: SP, approach: 'widen the cookie max-age setting', cwd: solvedDir }),
  call(83, 'record_solution', { problem: SP, solution: 'set SameSite=Lax; Strict dropped it on cross-site refresh', cwd: solvedDir }),
  call(84, 'check_anti_loop', { problem: SP, approach: 'widen the cookie max-age setting', cwd: solvedDir }),
  call(85, 'check_anti_loop', { problem: SP, approach: 'rip out the session layer and rewrite it', cwd: solvedDir }),
  call(86, 'check_anti_loop', { problem: 'something else entirely', approach: 'a fresh idea', cwd: solvedDir })
])
const k = (id) => JSON.parse(byId(solvedReplies, id).result.content[0].text)
ok('a repeated approach still blocks before it is solved', k(82).blocked === true)
ok('recording the fix clears the dead ends it went through',
   k(83).recorded === true && k(83).clearedDeadEnds === 1)
ok('the same approach stops being blocked once the problem is solved', k(84).blocked === false)
ok('and the fix itself is recalled, not just the fact that it was fixed',
   k(84).alreadySolved === true && /SameSite=Lax/.test(String(k(84).solution)))
ok('a DIFFERENT approach to solved work is warned not to undo it',
   k(85).alreadySolved === true && /do not undo/i.test(String(k(85).settled)))
ok('an unrelated problem is not told anything was solved', k(86).alreadySolved === undefined)
ok('record_solution refuses a solution it cannot act on',
   Boolean(byId(await drive([call(87, 'record_solution', { problem: 'x', cwd: solvedDir })]), 87).result.isError))

console.log(`\nPASS=${pass} FAIL=${fail}`)
process.exit(fail ? 1 : 0)
