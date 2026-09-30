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
import { historySnapshot } from '../overlay/src/main/planide/history'
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
  resetAgentTurnCache,
  normalizeTitle
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

// An agent reporting `works`/`done` sets `verified` and stamps its own name in
// `verified_by`. Counting that as YOUR confirmation is what made a real board
// read "63 confirmed by you, 0 claimed" after a single agent run closed out 63
// items the user had never looked at -- and it fed health too, so self-reported
// work scored as verified work. `verified_by === ''` is the only thing that
// means you.
const trustDir = mkdtempSync(join(tmpdir(), 'pulsar-trust-'))
const trust = store.loadState(trustDir)
const mine = store.addItem(trust, { title: 'I checked this one', status: 'works' })
const theirs = store.addItem(trust, {
  title: 'An agent closed this one',
  status: 'done',
  claimedBy: 'Pulse-Tracker'
})
store.verifyItem(trust, mine.id, true) // you: verifyItem always clears verified_by
// An agent's confirmation cannot come through verifyItem -- that path is yours
// by construction. It arrives as the MCP server writes it into state.json, so
// that is what is reproduced here rather than a shape no real run produces.
const agentItem = trust.items.find((i) => i.id === theirs.id)!
agentItem.verified = true
agentItem.verified_at = new Date().toISOString()
agentItem.verified_by = 'Pulse-Tracker'
const tp = store.progress(trust)
ok('an agent confirming its own work is not counted as confirmed by you',
  tp.confirmed === 1 && trust.items.find((i) => i.id === theirs.id)?.verified === true)
ok('it lands in the claimed-unchecked count instead, where the tile reads it',
  tp.unconfirmed === 1)
ok('and health is scored on your confirmations, not on self-reported work',
  tp.confirmed_percent === 50)
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
ok('waiting/blocked churn is ignored', recordAgentTurn(turn({}, { state: 'waiting' })) === false &&
   recordAgentTurn(turn({}, { state: 'blocked' })) === false)
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
ok('activity grew', agentState.activity.length > before)
// A `done` with no turn seen starting leaves no card behind. It used to land a
// `wip` card at every finished turn, which nothing ever moved again -- the
// "in behandeling, nobody picks it up" board.
ok('a finished turn alone leaves no card claiming work is in progress',
   agentState.items.filter((i) => (i.tags ?? []).includes('agent') && i.status === 'wip').length === 0)
ok('attributed to the agent that ran it', agentState.activity.some((x) => x.who === 'claude' && x.kind === 'agent-turn'))
ok('the closing summary is its own line',
   recordAgentTurn(turn({ promptInteractionKey: 'k3' }, { lastAssistantMessage: 'PPU scanline fixed' })) === true &&
   store.loadState(proj).activity.some((x) => x.kind === 'agent-said' && x.text.includes('scanline')))
ok('an interrupted turn says so',
   recordAgentTurn(turn({ promptInteractionKey: 'k4' }, { interrupted: true })) === true &&
   store.loadState(proj).activity.some((x) => x.kind === 'agent-interrupted'))
// A greeting is not a task: a one-word prompt logs activity but adds no card.
const cardsBefore = store.loadState(proj).items.filter((i) => (i.tags ?? []).includes('agent')).length
recordAgentTurn(turn({ promptInteractionKey: 'k5' }, { prompt: 'hi' }))
recordAgentTurn(turn({ paneKey: 'pane-hi' }, { state: 'working', prompt: 'hi' }))
ok('a trivial prompt makes no card',
   store.loadState(proj).items.filter((i) => (i.tags ?? []).includes('agent')).length === cardsBefore)

console.log('== a card lives exactly as long as the turn that holds it ==')
// "In progress" on the board has to mean an agent is on it right now. The card
// goes up when the turn starts, and when the turn ends it stops claiming so.
const life = mkdtempSync(join(tmpdir(), 'turn-life-'))
const T0 = Date.UTC(2026, 8, 30, 10, 0, 0)
const live = (pane: string, state: string, prompt: string, at: number, extra: Record<string, unknown> = {}) =>
  recordAgentTurn({
    worktreeId: wt(life), paneKey: pane, turnStartedAt: at,
    payload: { state, prompt, agentType: 'claude', ...extra }
  })
const board = () => store.loadState(life).items
const titled = (t: string) => board().find((i) => i.title === t)

ok('a turn starting on a real task puts its card up, in progress, held by that pane',
   live('p1', 'working', 'build the export dialog', T0) === true &&
   titled('build the export dialog')?.status === 'wip' &&
   titled('build the export dialog')?.held_by === 'p1')
ok('the same turn pinging working again does not add a second card',
   live('p1', 'working', 'build the export dialog', T0) === false &&
   board().filter((i) => i.title === 'build the export dialog').length === 1)
ok('a turn that ends without anyone touching its card takes the card with it',
   live('p1', 'done', 'build the export dialog', T0, { turnCompletedAt: 1 }) === true &&
   titled('build the export dialog') === undefined)
ok('and the turn itself stays in Activity, prompt and all',
   store.loadState(life).activity.some((a) => a.kind === 'agent-turn' && a.text.includes('build the export dialog')))

// The agent picking the card up is the whole idea -- then it is the agent's record.
live('p1', 'working', 'wire the save button', T0 + 60_000)
const saveCard = titled('wire the save button')!
{
  const st = store.loadState(life)
  store.updateItem(st, saveCard.id, { status: 'works', claimed_by: 'claude' })
  store.saveState(life, st)
}
live('p1', 'done', 'wire the save button', T0 + 60_000, { turnCompletedAt: 2 })
ok('a card the agent moved itself stays exactly where it was put, no longer held',
   titled('wire the save button')?.status === 'works' && titled('wire the save button')?.held_by === undefined)

// An existing to-do a turn picks up and does not finish goes back, with the why.
{
  const st = store.loadState(life)
  store.addItem(st, { title: 'migrate the settings page', status: 'todo' })
  store.saveState(life, st)
}
live('p2', 'working', 'migrate the settings page', T0 + 120_000)
ok('a turn on a planned to-do moves that item into progress instead of adding a card',
   titled('migrate the settings page')?.status === 'wip' &&
   board().filter((i) => i.title === 'migrate the settings page').length === 1)
live('p2', 'done', 'migrate the settings page', T0 + 120_000, { turnCompletedAt: 3, lastAssistantMessage: 'moved half of the fields' })
const migrated = titled('migrate the settings page')
ok('left unfinished, it goes back to To do with a dated note and the agent\'s own words',
   migrated?.status === 'todo' && migrated?.held_by === undefined &&
   (migrated?.notes ?? '').includes('without moving it to works/done') &&
   (migrated?.notes ?? '').includes('moved half of the fields'))

live('p2', 'working', 'migrate the settings page', T0 + 180_000)
live('p2', 'done', 'migrate the settings page', T0 + 180_000, { turnCompletedAt: 4, interrupted: true })
ok('an interrupted turn says so on the item',
   titled('migrate the settings page')?.status === 'todo' &&
   (titled('migrate the settings page')?.notes ?? '').includes('interrupted'))

// A turn whose end never arrived must not strand its card when the pane moves on.
live('p3', 'working', 'draft the release notes', T0 + 240_000)
live('p3', 'working', 'bump the version number', T0 + 300_000)
ok('a new turn in the same pane releases the card of the turn whose end was lost',
   titled('draft the release notes') === undefined &&
   titled('bump the version number')?.status === 'wip' && titled('bump the version number')?.held_by === 'p3')

// The IDE restarting mid-turn forgets its in-memory turn, not the board.
resetAgentTurnCache()
ok('after a restart, the running turn keeps its one card',
   live('p3', 'working', 'bump the version number', T0 + 300_000) === false &&
   board().filter((i) => i.title === 'bump the version number').length === 1 &&
   titled('bump the version number')?.status === 'wip')
live('p3', 'done', 'bump the version number', T0 + 300_000, { turnCompletedAt: 5 })

// An agent that picked the card up holds its id: the card must still exist for
// its closing update, even when the turn ends with it still in progress.
live('p5', 'working', 'tighten the retry budget', T0 + 420_000)
{
  const st = store.loadState(life)
  const card = st.items.find((i) => i.title === 'tighten the retry budget')!
  card.updated_at = '2099-01-01T00:00:00Z' // a later write by the agent, e.g. set_item
  store.saveState(life, st)
}
live('p5', 'done', 'tighten the retry budget', T0 + 420_000, { turnCompletedAt: 7 })
ok('a card an agent wrote to is kept for it, released to To do -- not deleted from under it',
   titled('tighten the retry budget')?.status === 'todo')

// Something you wrote on the card during the turn is yours: never deleted.
live('p4', 'working', 'profile the startup path', T0 + 360_000)
{
  const st = store.loadState(life)
  const card = st.items.find((i) => i.title === 'profile the startup path')!
  store.updateItem(st, card.id, { notes: 'check the splash screen first' })
  store.saveState(life, st)
}
live('p4', 'done', 'profile the startup path', T0 + 360_000, { turnCompletedAt: 6 })
ok('a card you added notes to is kept, back in To do, not removed',
   titled('profile the startup path')?.status === 'todo' &&
   (titled('profile the startup path')?.notes ?? '').includes('check the splash screen first'))
ok('when every turn has ended, nothing on the board claims work is in progress',
   board().filter((i) => i.status === 'wip').length === 0)

// One piece of work is one card whichever route wrote it: case, punctuation and
// accents do not make a new item, and non-Latin titles do not collapse into one.
ok('titles match across case, punctuation and accents',
   normalizeTitle('Café: fix the LOGIN.') === normalizeTitle('cafe fix the login'))
ok('a title in another script keeps its letters',
   normalizeTitle('修复登录页面') !== '' && normalizeTitle('修复登录页面') !== normalizeTitle('添加导出按钮'))

console.log('== the roadmap follows its items (IDE writes) ==')
{
  const road = mkdtempSync(join(tmpdir(), 'road-ide-'))
  let st = store.loadState(road)
  const a = store.addItem(st, { title: 'build the importer', status: 'wip' })
  const b = store.addItem(st, { title: 'test the importer', status: 'todo' })
  const m = store.addMilestone(st, 'Importer')
  ok('items link to a milestone', store.linkItemToMilestone(st, a.id, m.id) && store.linkItemToMilestone(st, b.id, m.id))
  store.saveState(road, st)
  st = store.loadState(road)
  store.updateItem(st, a.id, { status: 'works' })
  store.updateItem(st, b.id, { status: 'done' })
  store.saveState(road, st)
  st = store.loadState(road)
  ok('finishing every linked item completes the milestone on save', st.roadmap[0].done === true && st.roadmap[0].auto_done === true)
  store.updateItem(st, a.id, { status: 'broken' })
  store.saveState(road, st)
  st = store.loadState(road)
  ok('a linked item breaking reopens it', st.roadmap[0].done === false)
  store.updateMilestone(st, m.id, { done: true })
  store.saveState(road, st)
  st = store.loadState(road)
  ok('your own tick is kept even while an item is broken', st.roadmap[0].done === true && st.roadmap[0].manual === true)
  const snap = historySnapshot(st)
  ok('the history snapshot carries the roadmap it diffs', Array.isArray(snap.roadmap) && snap.roadmap.length === 1)
}

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
