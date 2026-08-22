/**
 * Tracker self-test: the real main-process modules, run for real.
 *
 * Bundled and executed by ide/verify.sh -- no Electron needed, because the
 * tracker is plain Node code that only touches the filesystem.
 */

import * as store from '../overlay/src/main/planide/store'
import { detect } from '../overlay/src/main/planide/detect'
import { buildReport } from '../overlay/src/main/planide/report'
import * as backup from '../overlay/src/main/planide/backup'
import {
  autoPushEnabled,
  resetAutoPush,
  runAutoPush,
  scheduleAutoPush,
  setAutoPush
} from '../overlay/src/main/planide/auto-push'
import {
  projectPathFromWorktreeId,
  recordAgentTurn,
  resetAgentTurnCache
} from '../overlay/src/main/planide/agent-events'
import { mkdtempSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

let pass = 0, fail = 0
const ok = (n: string, c: boolean): void => { c ? (pass++, console.log('  PASS ' + n)) : (fail++, console.log('  FAIL ' + n)) }

// a realistic project on disk
const proj = mkdtempSync(join(tmpdir(), 'planide-'))
mkdirSync(join(proj, 'src'))
writeFileSync(join(proj, 'CMakeLists.txt'), 'cmake_minimum_required(VERSION 3.16)')
writeFileSync(join(proj, 'src', 'cpu.cpp'), 'int execute_opcode(unsigned op){return 0;}')
writeFileSync(join(proj, 'src', 'ppu.cpp'), '// pixel unit')

console.log('== detect ==')
const d = detect(proj)
ok('type is emulator (opcode/cpu hints)', d.type === 'emulator')
ok('C++ detected', d.languages.includes('C++'))
ok('cmake marker found', d.stack.includes('cmake'))
ok('confidence high', d.confidence === 'high')

console.log('== store: create + persist ==')
let st = store.loadState(proj)
ok('blank state has a name', st.name.length > 0)
const a = store.addItem(st, { title: 'ARM7 CPU core', status: 'done' })
const b = store.addItem(st, { title: 'PPU rendering', status: 'works', claimedBy: 'Claude' })
store.addItem(st, { title: 'Link cable', status: 'todo' })
store.saveState(proj, st)
st = store.loadState(proj)
ok('state round-trips to disk', st.items.length === 3)
ok('claimed_by persisted', st.items[1].claimed_by === 'Claude')

console.log('== trust boundary ==')
store.updateItem(st, a.id, { verified: true } as never)
ok('updateItem cannot set verified', st.items[0].verified === false)
store.updateItem(st, a.id, { locked: true } as never)
ok('updateItem cannot set locked', st.items[0].locked === false)
store.verifyItem(st, a.id, true)
ok('verifyItem confirms', st.items[0].verified === true)
store.lockItem(st, a.id, true)
ok('lockItem protects', st.items[0].locked === true)
store.updateItem(st, a.id, { status: 'broken', claimed_by: 'Codex' })
ok('status change drops confirmation', st.items[0].verified === false)
ok('protection survives a status change', st.items[0].locked === true)
ok('regression detected', store.regressions(st).length === 1)

console.log('== progress ==')
const p = store.progress(st)
ok('claimed vs confirmed are separate', p.percent !== p.confirmed_percent || p.confirmed === 0)
ok('regressed counted', p.regressed === 1)
ok('protected counted', p.protected === 1)
ok('open counted (todo)', p.open === 1)
ok('health hit hard by regression', p.health < 20)

console.log('== activity ==')
const kinds = new Set(st.activity.map((x) => x.kind))
ok('logs item-add', kinds.has('item-add'))
ok('logs lock + verify', kinds.has('lock') && kinds.has('verify'))
ok('attributes the agent', st.activity.some((x) => x.who === 'Codex'))
ok('names the regression', st.activity.some((x) => x.text.includes('REGRESSION')))

console.log('== briefing ==')
store.lockItem(st, b.id, true)
const md = buildReport(st, 'full')
ok('leads with REGRESSION', md.indexOf('REGRESSION') < md.indexOf('## What works'))
ok('has DO NOT BREAK', md.includes('DO NOT BREAK (protected by the user)'))
ok('separates confirmed from claimed', md.includes('Reported working, NOT yet confirmed'))
ok('tells agent not to self-confirm', md.includes('only records a claim'))

console.log('== agent turns (recorded from Orca hooks, not by the agent) ==')
store.saveState(proj, st)
resetAgentTurnCache()
const wt = (p: string): string => `repo_1::${p}`
ok('worktree id yields the project path', projectPathFromWorktreeId(wt(proj)) === proj)
ok('a path containing :: survives', projectPathFromWorktreeId('r::/a::b') === '/a::b')
ok('a malformed id is refused', projectPathFromWorktreeId('nope') === null)
ok('a degenerate id is refused', projectPathFromWorktreeId('::/a') === null &&
   projectPathFromWorktreeId('r::') === null)

const turn = (extra: Record<string, unknown> = {}, payload: Record<string, unknown> = {}) => ({
  worktreeId: wt(proj), paneKey: 'pane-1',
  payload: { state: 'done', prompt: 'wire the PPU', agentType: 'claude', ...payload },
  ...extra
})
const before = store.loadState(proj).activity.length
ok('a finished turn is recorded', recordAgentTurn(turn()) === true)
ok('the same delivery is not recorded twice', recordAgentTurn(turn()) === false)
ok('a replay is ignored', recordAgentTurn(turn({ isReplay: true }, { turnCompletedAt: 2 })) === false)
ok('working/waiting churn is ignored', recordAgentTurn(turn({}, { state: 'working' })) === false)
// Upstream marks connect/resume/clear as a `done` that is not a completed turn.
ok('a session boundary is ignored', recordAgentTurn(turn({}, { sessionBoundary: true, turnCompletedAt: 3 })) === false)
// The board starts itself: a project you never opened the Tracker tab in still
// gets its trail from the first finished turn. (This assertion is deliberately
// the inverse of what it used to be -- requiring a pre-existing state.json meant
// running a whole task through an agent left the tracker completely empty.)
const fresh = mkdtempSync(join(tmpdir(), 'untracked-'))
ok('a project with no board yet gets one from the first finished turn',
   recordAgentTurn({ worktreeId: wt(fresh), payload: { state: 'done', agentType: 'codex', prompt: 'build the thing' } }) === true &&
   existsSync(join(fresh, '.planide', 'state.json')))
// A remote (SSH) worktree's path does not exist locally -- still never written.
ok('a path that does not exist locally is left alone',
   recordAgentTurn({ worktreeId: wt(join(tmpdir(), 'no-such-dir-' + Date.now())), payload: { state: 'done' } }) === false)
// Orca's own per-turn key is authoritative, so the same key is always a duplicate...
ok('a repeat of the same turn key is one entry',
   recordAgentTurn(turn({ promptInteractionKey: 'k1' })) === true &&
   recordAgentTurn(turn({ promptInteractionKey: 'k1' })) === false)
// ...but a genuine second run of the same prompt still gets its own line.
ok('a new turn key is a new entry', recordAgentTurn(turn({ promptInteractionKey: 'k2' })) === true)

const agentState = store.loadState(proj)
ok('activity grew, board did not', agentState.activity.length > before && agentState.items.length === st.items.length)
ok('attributed to the agent that ran it', agentState.activity.some((x) => x.who === 'claude' && x.kind === 'agent-turn'))
ok('the closing summary is its own line',
   recordAgentTurn(turn({ promptInteractionKey: 'k3' }, { lastAssistantMessage: 'PPU scanline fixed' })) === true &&
   store.loadState(proj).activity.some((x) => x.kind === 'agent-said' && x.text.includes('scanline')))
ok('an interrupted turn says so',
   recordAgentTurn(turn({ promptInteractionKey: 'k4' }, { interrupted: true })) === true &&
   store.loadState(proj).activity.some((x) => x.kind === 'agent-interrupted'))

console.log('== backup (own zip writer) ==')
store.saveState(proj, st)
const r = backup.create(proj, st.version, 'test')
ok('snapshot created', r.ok === true && (r.files ?? 0) > 0)
const list = backup.listing(proj)
ok('snapshot listed', list.length === 1 && list[0].file === r.file)
const second = backup.create(proj, st.version, 'nested')
ok('a second snapshot does not nest the first', (second.files ?? 0) === (r.files ?? 0))

// The ZIP is hand-written (no archive dependency), so prove an independent
// reader accepts it rather than trusting our own writer.
if (process.env.PLANIDE_ZIP_OUT) writeFileSync(process.env.PLANIDE_ZIP_OUT, r.path ?? '')

// --- auto-push: off unless asked, debounced, and never silent ---------------
// The push itself shells out to git; the runner is injected here so the
// decision logic is tested for real without a network or a remote.
void (async () => {
  console.log('== auto-push ==')
  resetAutoPush()
  let st2 = store.loadState(proj)
  ok('off by default', autoPushEnabled(st2) === false)
  ok('a change arms nothing while off', scheduleAutoPush(proj, st2) === false)

  setAutoPush(st2, true)
  store.saveState(proj, st2)
  ok('the switch is on', autoPushEnabled(store.loadState(proj)) === true)
  ok('flipping it is recorded', store.loadState(proj).activity[0].kind === 'auto-push')

  // Debounce: three changes in a row must produce one push, not three.
  let runs = 0
  const runner = async (): Promise<{
    ok: boolean; committed: boolean; pushed: boolean; branch: string; log: string[]; push_error: string
  }> => {
    runs += 1
    return { ok: true, committed: true, pushed: true, branch: 'main', log: [], push_error: '' }
  }
  for (let i = 0; i < 3; i++) scheduleAutoPush(proj, st2, { delayMs: 20, run: runner })
  await new Promise((r) => setTimeout(r, 120))
  ok('three changes push once', runs === 1)

  const after = store.loadState(proj)
  ok('the push is stamped', (after.github?.last_sync ?? '').length > 0)
  ok('and lands in activity', after.activity.some((a) => a.kind === 'auto-push' && a.text.includes('pushed')))

  // Turning it off must cancel what is already armed.
  runs = 0
  scheduleAutoPush(proj, store.loadState(proj), { delayMs: 20, run: runner })
  const off = store.loadState(proj)
  setAutoPush(off, false, proj)
  store.saveState(proj, off)
  await new Promise((r) => setTimeout(r, 120))
  ok('turning it off cancels the armed push', runs === 0)

  // A push that fires after the switch flipped off must still not push.
  ok('a fired timer re-checks the switch', (await runAutoPush(proj, runner)) === false)

  // A failing push is reported, not swallowed.
  setAutoPush(st2, true)
  store.saveState(proj, st2)
  await runAutoPush(proj, async () => ({
    ok: false, committed: true, pushed: false, branch: 'main', log: [], push_error: 'no upstream'
  }))
  ok(
    'a failed push says so',
    store.loadState(proj).activity.some((a) => a.text.includes('push failed: no upstream'))
  )
  resetAutoPush()

  console.log('')
  console.log(`PASS=${pass} FAIL=${fail}`)
  if (fail) process.exit(1)
})()
