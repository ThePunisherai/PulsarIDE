/**
 * PlanIDE tracker — state model, in the IDE's own main process.
 *
 * No server, no port, no runtime dependency: this reads and writes plain JSON
 * on disk and is called over IPC by the renderer. State lives in
 * `<project>/.planide/state.json`, inside the project, so it travels with the
 * code and can be committed.
 *
 * Two orthogonal axes, deliberately never merged:
 *   status  — what state the thing is in; anyone, including an agent, may move it
 *   flags   — `verified` (you confirmed it) and `locked` ("do not break"), which
 *             ONLY the user sets. `updateItem` cannot touch either, so an agent
 *             can never confirm its own work or unprotect what it is rewriting.
 *
 * The same JSON is read/written by the optional Python CLI and MCP server that
 * agents use, so the schema here is a contract — see docs/STATE-SCHEMA.md.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

export const ITEM_STATUSES = ['todo', 'wip', 'works', 'broken', 'blocked', 'done'] as const
export type ItemStatus = (typeof ITEM_STATUSES)[number]

/** Counts as working software. */
const DONE_ITEM: ItemStatus[] = ['works', 'done']
/** Counts as finished. */
const COMPLETE_ITEM: ItemStatus[] = ['done']
/** Still to be done. */
const OPEN_ITEM: ItemStatus[] = ['todo', 'wip']
/** Needs attention. */
const OPEN_BAD: ItemStatus[] = ['broken', 'blocked']

export type Item = {
  id: string
  title: string
  status: ItemStatus
  notes: string
  tags: string[]
  priority: string
  created_at: string
  updated_at: string
  /** Who reported it (agent name); empty when you entered it yourself. */
  claimed_by: string
  /**
   * Someone confirmed it works. Read this WITH `verified_by`, never alone:
   * an agent reporting `works`/`done` sets it too, and treating that as your
   * confirmation is how a board ends up claiming you checked 63 things you
   * never looked at.
   */
  verified: boolean
  verified_at: string
  /** Who confirmed it: '' = you, otherwise the agent that reported it working. */
  verified_by: string
  /** "Do not break this." Never set by an agent. */
  locked: boolean
  locked_at: string
  /**
   * The agent plan that created this row (work-queue.mjs planKey). A later
   * plan from the same session takes it back off the board if it drops it
   * while still open. Your edit removes it: then the row is yours.
   */
  plan_key?: string
  /**
   * An agent's plan for this item, as its checklist (work-queue.mjs
   * applyChecklist): the item closes when every step is done.
   */
  /** `carried`: finished by an earlier chat on this item, kept when a later chat re-plans it. */
  steps?: { title: string; status: 'todo' | 'wip' | 'done' | 'blocked'; carried?: boolean }[]
  /** The plan that wrote `steps`, so a re-sent plan lands here again. */
  steps_key?: string
}

export type Fix = {
  id: string
  title: string
  problem: string
  solution: string
  item_id: string
  agent: string
  status: 'open' | 'fixed' | 'wontfix'
  created_at: string
  fixed_at: string
}

export type Milestone = {
  id: string
  title: string
  target: string
  done: boolean
  order: number
  item_ids: string[]
}

export type Version = {
  version: string
  date: string
  notes: string
  added: string[]
  fixed: string[]
  changed: string[]
}

export type Activity = {
  id: string
  at: string
  kind: string
  text: string
  /** "you" for your own actions, otherwise the agent that did it. */
  who: string
}

export type Detected = {
  languages: string[]
  stack: string[]
  type: string
  confidence: string
  signals: string[]
  markers: string[]
}

export type ProjectState = {
  id: string
  name: string
  path: string
  type: string
  stack: { detected: Partial<Detected>; custom: string }
  version: string
  created_at: string
  updated_at: string
  items: Item[]
  fixes: Fix[]
  roadmap: Milestone[]
  versions: Version[]
  github: { remote: string; branch: string; lfs: boolean; auto_push: boolean; last_sync: string }
  backups: unknown[]
  activity: Activity[]
  /**
   * The user's switches -- never written by an agent-facing path.
   * auto_complete: work an agent reports working counts as finished (`done`),
   * with no one ticking it off by hand. Missing reads as on.
   * autopilot: an agent that finishes what it was doing takes the next item
   * on the board instead of stopping (hooks/keep-going.mjs). Missing reads as on.
   */
  settings: { auto_complete: boolean; autopilot?: boolean }
}

export type Progress = {
  total_items: number
  counts: Record<string, number>
  done: number
  /** Confirmed by YOU -- never an agent, whatever the settings say. */
  confirmed: number
  /** Working and not counted as finished: with auto-complete on, none. */
  unconfirmed: number
  confirmed_percent: number
  /** The user's auto-complete switch, as this board has it. */
  auto_complete: boolean
  /** The user's autopilot switch: agents keep working the board unasked. */
  autopilot: boolean
  /** Counted as finished: everything that works with auto-complete on, else your checks. */
  accepted: number
  accepted_percent: number
  /** Working items an agent reported and you did not check yourself. */
  by_agents: number
  complete: number
  open: number
  protected: number
  regressed: number
  broken: number
  percent: number
  open_fixes: number
  fixed: number
  milestones_total: number
  milestones_done: number
  milestones_percent: number
  health: number
  version: string
}

const ACTIVITY_CAP = 400

export function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
}

function newId(prefix: string): string {
  return prefix + randomUUID().replace(/-/g, '').slice(0, 12)
}

export function statePath(projectPath: string): string {
  return join(projectPath, '.planide', 'state.json')
}

function blankState(projectPath: string): ProjectState {
  const name = projectPath.replace(/[/\\]+$/, '').split(/[/\\]/).pop() || 'project'
  return {
    id: newId('p_'),
    name,
    path: projectPath,
    type: 'custom',
    stack: { detected: {}, custom: '' },
    version: '0.1.0',
    created_at: nowIso(),
    updated_at: nowIso(),
    items: [],
    fixes: [],
    roadmap: [],
    versions: [],
    github: { remote: '', branch: 'main', lfs: false, auto_push: false, last_sync: '' },
    backups: [],
    activity: [],
    settings: { auto_complete: true, autopilot: true }
  }
}

/** Read a project's state, creating and migrating it as needed. */
export function loadState(projectPath: string): ProjectState {
  const file = statePath(projectPath)
  let state: ProjectState
  try {
    state = JSON.parse(readFileSync(file, 'utf8')) as ProjectState
  } catch {
    state = blankState(projectPath)
    saveState(projectPath, state)
    return state
  }
  // Forward-compat: fill in anything a state written by an older version (or by
  // the Python CLI) is missing, so the UI never reads undefined.
  const blank = blankState(projectPath)
  for (const [k, v] of Object.entries(blank)) {
    if ((state as Record<string, unknown>)[k] === undefined) {
      ;(state as Record<string, unknown>)[k] = v
    }
  }
  state.path = projectPath
  for (const item of state.items ?? []) {
    item.claimed_by ??= ''
    item.verified ??= false
    item.verified_at ??= ''
    item.verified_by ??= ''
    item.locked ??= false
    item.locked_at ??= ''
    item.tags ??= []
    item.notes ??= ''
  }
  // A fix with no status was logged by the IDE before addFix kept its default
  // (see addFix): it was meant to be open, so it is open -- in Fixes > Open,
  // in the counts, and in the work queue.
  for (const fix of state.fixes ?? []) {
    if (!(['open', 'fixed', 'wontfix'] as readonly string[]).includes(fix.status)) fix.status = 'open'
  }
  return state
}

export function saveState(projectPath: string, state: ProjectState): void {
  state.updated_at = nowIso()
  const dir = join(projectPath, '.planide')
  mkdirSync(dir, { recursive: true })
  const file = statePath(projectPath)
  // Write-then-rename so a crash mid-write cannot truncate the board.
  //
  // The temp name carries this process's pid ON PURPOSE. The IDE and an agent's
  // MCP server both write this file, by design and at the same time -- that is
  // the whole point of a live board. With a shared `state.json.tmp` they share
  // an inode: one can truncate the other's half-written temp, or rename it away
  // while the other still holds it open, at which point the loser's remaining
  // writes land inside the live board. A pid-unique name means the two never
  // touch the same temp, and rename stays atomic.
  const tmp = `${file}.${process.pid}.tmp`
  // Clean up after a failed rename. On Windows an AV scanner or the search
  // indexer can hold the target just long enough for renameSync to throw, and
  // the old shape left the temp behind -- with a pid in its name, so a new one
  // accumulated per process rather than overwriting the last. The write still
  // fails loudly; it just does not litter.
  try {
    writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
    renameSync(tmp, file)
  } catch (err) {
    try {
      rmSync(tmp, { force: true })
    } catch {
      /* best effort -- the original error is what matters */
    }
    throw err
  }
}

export function projectExists(projectPath: string): boolean {
  return existsSync(projectPath)
}

// --------------------------------------------------------------------------- activity
export function logActivity(
  state: ProjectState,
  kind: string,
  text: string,
  who = 'you'
): void {
  state.activity ??= []
  state.activity.unshift({ id: newId('a_'), at: nowIso(), kind, text, who: who || 'you' })
  state.activity.length = Math.min(state.activity.length, ACTIVITY_CAP)
}

// --------------------------------------------------------------------------- items
export function addItem(
  state: ProjectState,
  opts: {
    title: string
    status?: ItemStatus
    notes?: string
    tags?: string[]
    priority?: string
    claimedBy?: string
  }
): Item {
  const status = (ITEM_STATUSES as readonly string[]).includes(opts.status ?? '')
    ? (opts.status as ItemStatus)
    : 'todo'
  const item: Item = {
    id: newId('i_'),
    title: opts.title.trim() || 'Untitled',
    status,
    notes: opts.notes ?? '',
    tags: opts.tags ?? [],
    priority: opts.priority ?? 'normal',
    created_at: nowIso(),
    updated_at: nowIso(),
    claimed_by: opts.claimedBy ?? '',
    verified: false,
    verified_at: '',
    verified_by: '',
    locked: false,
    locked_at: ''
  }
  state.items.push(item)
  logActivity(state, 'item-add', `added ${item.title} (${status})`, opts.claimedBy || 'you')
  return item
}

/**
 * Update an item's own fields.
 *
 * `locked` is still yours alone -- an agent must never unprotect what it is
 * about to change.
 *
 * `verified` works differently now, by request: an agent moving something to
 * `works` or `done` confirms it, so the board goes green as work lands instead
 * of waiting on you to tick every row. What keeps that honest is attribution --
 * `verified_by` records WHO confirmed, so an agent's confirmation still reads as
 * the agent's, and you can decline it. Any other status change still drops the
 * confirmation: what was confirmed is no longer what the item says.
 */
export function updateItem(
  state: ProjectState,
  itemId: string,
  fields: Partial<Pick<Item, 'title' | 'status' | 'notes' | 'tags' | 'priority' | 'claimed_by'>>
): Item | null {
  const item = state.items.find((i) => i.id === itemId)
  if (!item) return null
  const statusChanged =
    fields.status !== undefined &&
    (ITEM_STATUSES as readonly string[]).includes(fields.status) &&
    fields.status !== item.status

  if (statusChanged && item.verified) {
    item.verified = false
    item.verified_at = ''
    item.verified_by = ''
  }
  // An agent reporting something working confirms it, attributed to that agent.
  // `claimed_by` is what tells us an agent is speaking rather than you.
  const reporter = fields.claimed_by || item.claimed_by || ''
  const autoConfirm =
    statusChanged && (fields.status === 'works' || fields.status === 'done') && Boolean(reporter)
  // Runtime allowlist, not just the TypeScript signature: this is reachable over
  // IPC with arbitrary JSON, so `verified` and `locked` must be impossible to
  // slip in here -- that is the whole trust boundary.
  const WRITABLE = new Set(['title', 'status', 'notes', 'tags', 'priority', 'claimed_by'])
  for (const [k, v] of Object.entries(fields)) {
    if (!WRITABLE.has(k)) continue
    if (k === 'status' && !(ITEM_STATUSES as readonly string[]).includes(v as string)) continue
    ;(item as unknown as Record<string, unknown>)[k] = v
  }
  if (autoConfirm) {
    item.verified = true
    item.verified_at = nowIso()
    item.verified_by = reporter
  }
  // Renamed, annotated or prioritised by you: the row is yours now, and no
  // agent plan takes it back off the board (retireDroppedSteps).
  if (!fields.claimed_by && ['title', 'notes', 'priority'].some((k) => k in fields)) delete item.plan_key
  item.updated_at = nowIso()
  if (fields.status !== undefined) {
    const who = fields.claimed_by || item.claimed_by || 'you'
    const note = item.locked && OPEN_BAD.includes(item.status) ? ' (was protected -- REGRESSION)' : ''
    logActivity(state, 'item-status', `${item.title} -> ${item.status}${note}`, who)
  }
  return item
}

/** The board's session records (sessions.json, written by the agents' hooks); {} if none. */
export function readSessionRecords(path: string): Record<string, { seen?: string }> {
  try {
    const raw = JSON.parse(readFileSync(join(path, '.planide', 'sessions.json'), 'utf8'))
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  } catch {
    return {}
  }
}

/**
 * Plan steps a chat that has since closed left on the board as rows of their
 * own -- the way every plan landed before plans became their item's
 * checklist. Open (todo/wip), untouched for a day, from a plan whose chat has
 * not been seen for a day, and never one you made yours (protected,
 * confirmed, annotated or prioritised). They are what kept a board at "34/50"
 * whatever got done. Listed, never removed, until you say so (tidyPlanSteps).
 */
export function leftoverPlanSteps(
  state: ProjectState,
  opts: { sessions?: Record<string, { seen?: string }>; now?: number } = {}
): Item[] {
  const now = opts.now ?? Date.now()
  const day = 24 * 3600e3
  const sessions = opts.sessions ?? {}
  return (state.items ?? []).filter((i) => {
    if (!i.plan_key || (i.status !== 'todo' && i.status !== 'wip')) return false
    if (i.locked || (i.verified && !i.verified_by) || String(i.notes ?? '').trim()) return false
    if (!['', 'normal', 'medium'].includes(String(i.priority ?? '').trim().toLowerCase())) return false
    const quiet = now - Date.parse(i.updated_at || '')
    if (!(quiet > day)) return false
    const seen = Date.parse(sessions[i.plan_key.split('#')[0]]?.seen || '')
    return !(Number.isFinite(seen) && now - seen < day)
  })
}

/** Take the leftover plan steps off the board, at your say-so. Returns how many went. */
export function tidyPlanSteps(
  state: ProjectState,
  opts: { sessions?: Record<string, { seen?: string }>; now?: number } = {}
): number {
  const gone = new Set(leftoverPlanSteps(state, opts).map((i) => i.id))
  if (!gone.size) return 0
  state.items = state.items.filter((i) => !gone.has(i.id))
  for (const m of state.roadmap ?? []) m.item_ids = (m.item_ids ?? []).filter((id) => !gone.has(id))
  logActivity(state, 'item-delete', `tidied ${gone.size} leftover plan step(s) from closed chats`)
  return gone.size
}

export function deleteItem(state: ProjectState, itemId: string): boolean {
  const before = state.items.length
  const removed = state.items.find((i) => i.id === itemId)
  state.items = state.items.filter((i) => i.id !== itemId)
  for (const m of state.roadmap) m.item_ids = (m.item_ids ?? []).filter((id) => id !== itemId)
  if (removed) logActivity(state, 'item-delete', `deleted ${removed.title}`)
  return state.items.length !== before
}

/**
 * Confirm (or un-confirm) that an item really works.
 * The only path that sets `verified`, and deliberately not reachable from the
 * agent-facing surfaces — "an agent says it works" and "you saw it work" must
 * never collapse into one signal.
 */
export function verifyItem(state: ProjectState, itemId: string, verified: boolean): Item | null {
  const item = state.items.find((i) => i.id === itemId)
  if (!item) return null
  item.verified = verified
  item.verified_at = verified ? nowIso() : ''
  // Yours: confirming clears the agent's name, declining clears it entirely.
  item.verified_by = ''
  item.updated_at = nowIso()
  logActivity(state, 'verify', `${verified ? 'confirmed' : 'unconfirmed'} ${item.title}`)
  return item
}

/**
 * Protect an item: "this works and must NOT be broken".
 * Yours alone, for the same reason as verification: an agent must never be able
 * to unprotect the thing it is about to refactor.
 */
export function lockItem(state: ProjectState, itemId: string, locked: boolean): Item | null {
  const item = state.items.find((i) => i.id === itemId)
  if (!item) return null
  item.locked = locked
  item.locked_at = locked ? nowIso() : ''
  item.updated_at = nowIso()
  logActivity(state, 'lock', `${locked ? 'protected' : 'unprotected'} ${item.title}`)
  return item
}

/** Protected items that are no longer working — the alarm that matters. */
export function regressions(state: ProjectState): Item[] {
  return state.items.filter((i) => i.locked && OPEN_BAD.includes(i.status))
}

// --------------------------------------------------------------------------- fixes
export function addFix(
  state: ProjectState,
  opts: {
    title: string
    problem?: string
    solution?: string
    itemId?: string
    agent?: string
    status?: Fix['status']
  }
): Fix {
  // The default has to be the VALUE, not just the check. This used to test
  // `opts.status ?? 'open'` and then hand back `opts.status` itself -- undefined
  // for every fix logged from the IDE, which passes no status. JSON drops an
  // undefined field, so those fixes had no status at all: never under Fixes >
  // Open, never in the open-fix count, never in an agent's queue.
  const asked = opts.status ?? 'open'
  const status: Fix['status'] = (['open', 'fixed', 'wontfix'] as const).includes(asked) ? asked : 'open'
  const fix: Fix = {
    id: newId('f_'),
    title: opts.title.trim() || 'Untitled fix',
    problem: opts.problem ?? '',
    solution: opts.solution ?? '',
    item_id: opts.itemId ?? '',
    agent: opts.agent ?? '',
    status,
    created_at: nowIso(),
    fixed_at: status === 'fixed' ? nowIso() : ''
  }
  state.fixes.push(fix)
  logActivity(state, 'fix-add', `logged fix: ${fix.title}`, opts.agent || 'you')
  return fix
}

export function updateFix(
  state: ProjectState,
  fixId: string,
  fields: Partial<Pick<Fix, 'title' | 'problem' | 'solution' | 'item_id' | 'agent' | 'status'>>
): Fix | null {
  const fix = state.fixes.find((f) => f.id === fixId)
  if (!fix) return null
  const before = fix.status
  const WRITABLE = new Set(['title', 'problem', 'solution', 'item_id', 'agent', 'status'])
  for (const [k, v] of Object.entries(fields)) {
    if (!WRITABLE.has(k)) continue
    ;(fix as unknown as Record<string, unknown>)[k] = v
  }
  // A fix can come back. Closing stamps fixed_at, so anything that moves it OUT
  // of `fixed` has to clear that stamp -- otherwise a reopened entry keeps
  // claiming it was closed on a date that no longer means anything. The old
  // guard here was `status === 'fixed' && !fixed_at`, which also meant a
  // reopened fix could never log its second close: fixed_at was still set from
  // the first one, so the branch never ran. Keyed on a real status CHANGE now,
  // and labelled by where it lands rather than where it came from.
  if (before !== fix.status) {
    if (fix.status === 'fixed') {
      fix.fixed_at = nowIso()
      logActivity(state, 'fix-done', `fixed: ${fix.title}`, fix.agent || 'you')
    } else {
      fix.fixed_at = ''
      if (fix.status === 'wontfix') {
        logActivity(state, 'fix-wontfix', `parked: ${fix.title}`, fix.agent || 'you')
      } else {
        logActivity(state, 'fix-reopen', `reopened: ${fix.title}`, fix.agent || 'you')
      }
    }
  }
  return fix
}

export function deleteFix(state: ProjectState, fixId: string): boolean {
  const before = state.fixes.length
  state.fixes = state.fixes.filter((f) => f.id !== fixId)
  return state.fixes.length !== before
}

// --------------------------------------------------------------------------- roadmap
export function addMilestone(state: ProjectState, title: string, target = ''): Milestone {
  const m: Milestone = {
    id: newId('m_'),
    title: title.trim() || 'Milestone',
    target,
    done: false,
    order: state.roadmap.length,
    item_ids: []
  }
  state.roadmap.push(m)
  return m
}

export function updateMilestone(
  state: ProjectState,
  mid: string,
  fields: Partial<Pick<Milestone, 'title' | 'target' | 'done' | 'order' | 'item_ids'>>
): Milestone | null {
  const m = state.roadmap.find((x) => x.id === mid)
  if (!m) return null
  const WRITABLE = new Set(['title', 'target', 'done', 'order', 'item_ids'])
  for (const [k, v] of Object.entries(fields)) {
    if (!WRITABLE.has(k)) continue
    ;(m as unknown as Record<string, unknown>)[k] = v
  }
  return m
}

export function deleteMilestone(state: ProjectState, mid: string): boolean {
  const before = state.roadmap.length
  state.roadmap = state.roadmap.filter((m) => m.id !== mid)
  return state.roadmap.length !== before
}

// --------------------------------------------------------------------------- versions
export function addVersion(
  state: ProjectState,
  version: string,
  opts: { notes?: string; added?: string[]; fixed?: string[]; changed?: string[] } = {}
): Version {
  const entry: Version = {
    version: version.trim() || state.version,
    date: nowIso(),
    notes: opts.notes ?? '',
    added: opts.added ?? [],
    fixed: opts.fixed ?? [],
    changed: opts.changed ?? []
  }
  state.versions.unshift(entry)
  state.version = entry.version
  logActivity(state, 'version', `cut v${entry.version}`)
  return entry
}

// --------------------------------------------------------------------------- auto-complete
/** The user's switch. Missing reads as on -- see work-queue.mjs, which agents run. */
export function autoComplete(state: Pick<ProjectState, 'settings'> | null | undefined): boolean {
  return state?.settings?.auto_complete !== false
}

/**
 * Close out what an agent reported working: `works` -> `done`, so finished work
 * never waits on anyone to move it by hand. Agent-reported items only (a
 * `works` you chose yourself stays), never a protected one, and a confirmation
 * is kept -- both statuses say it works. Must stay identical to
 * closeOutWorking in agent-bundle/tracker/mcp/work-queue.mjs; the parity test
 * in ide/test/mcp-node.test.mjs runs both on the same board.
 */
export function closeOutWorking(state: ProjectState): Item[] {
  if (!autoComplete(state)) return []
  const at = nowIso()
  const closed: Item[] = []
  for (const item of state.items ?? []) {
    if (item.status !== 'works' || item.locked || !String(item.claimed_by || '').trim()) continue
    item.status = 'done'
    item.updated_at = at
    closed.push(item)
  }
  if (closed.length) {
    const names = closed.map((i) => i.title).slice(0, 3).join(', ')
    logActivity(
      state,
      'auto-complete',
      `closed out ${closed.length} working item(s): ${names}${closed.length > 3 ? ', ...' : ''}`,
      'auto'
    )
  }
  return closed
}

/** The autopilot switch. Missing reads as on -- see autopilot in work-queue.mjs. */
export function autopilot(state: Pick<ProjectState, 'settings'> | null | undefined): boolean {
  return state?.settings?.autopilot !== false
}

/** Yours alone, like auto-complete: no agent-facing path reaches it. */
export function setAutopilot(state: ProjectState, enabled: boolean): boolean {
  state.settings = { ...(state.settings ?? { auto_complete: true }), autopilot: Boolean(enabled) }
  logActivity(state, 'settings', `autopilot ${enabled ? 'on' : 'off'}`)
  return state.settings.autopilot !== false
}

/** Yours alone, like confirming and protecting: no agent-facing path reaches it. */
export function setAutoComplete(state: ProjectState, enabled: boolean): boolean {
  state.settings = { ...(state.settings ?? { auto_complete: true }), auto_complete: Boolean(enabled) }
  logActivity(state, 'settings', `auto-complete ${enabled ? 'on' : 'off'}`)
  // Switching it on applies at once: what already works is closed out now,
  // not on whatever write happens to come next.
  if (enabled) closeOutWorking(state)
  return state.settings.auto_complete
}

// --------------------------------------------------------------------------- rollups
export function progress(state: ProjectState): Progress {
  const items = state.items ?? []
  const total = items.length
  const counts: Record<string, number> = {}
  for (const s of ITEM_STATUSES) counts[s] = 0
  for (const i of items) counts[i.status] = (counts[i.status] ?? 0) + 1

  const done = DONE_ITEM.reduce((n, s) => n + (counts[s] ?? 0), 0)
  const broken = OPEN_BAD.reduce((n, s) => n + (counts[s] ?? 0), 0)
  const percent = total ? Math.round((100 * done) / total) : 0

  // Two different truths, never merged into one number:
  //   done      -- items whose status says they work (often an agent's claim)
  //   confirmed -- items YOU confirmed actually work
  //
  // `verified` alone is not that second truth, and reading it as if it were is
  // a bug this board existed to prevent. An agent reporting `works` or `done`
  // sets `verified` and stamps its own name in `verified_by` -- by design, so
  // the card can say "claimed by X". The rollup then counted those as yours,
  // and the header says "confirmed by you, not claimed by an agent". A run
  // where one agent closed out 63 items showed 63 confirmed BY YOU and 0
  // claimed, which is the exact opposite of what happened, and it also fed
  // health, so self-reported work scored as verified work.
  //
  // `verified_by === ''` is what actually means you: set_verified writes your
  // confirmation with no name, every agent path writes a name.
  const working = items.filter((i) => DONE_ITEM.includes(i.status))
  const confirmed = working.filter((i) => i.verified && !i.verified_by).length
  const confirmedPercent = total ? Math.round((100 * confirmed) / total) : 0
  // What counts as finished is the user's call, and they made it: "wat werkt
  // mag als afgerond zijn, ik ga niet handmatig dat doen". With auto-complete
  // on, everything that works is accepted; off, only your own checks are, and
  // the rest is somebody's claim -- exactly the old split. `confirmed` stays
  // YOUR checks either way, so the board never says you looked when you did not.
  const auto = autoComplete(state)
  const accepted = auto ? working.length : confirmed
  const acceptedPercent = total ? Math.round((100 * accepted) / total) : 0
  const unconfirmed = working.length - accepted
  const byAgents = working.filter(
    (i) => !(i.verified && !i.verified_by) && Boolean(i.claimed_by || i.verified_by)
  ).length

  const complete = items.filter((i) => COMPLETE_ITEM.includes(i.status)).length
  const open = items.filter((i) => OPEN_ITEM.includes(i.status)).length
  const protectedCount = items.filter((i) => i.locked).length
  const regressed = regressions(state).length

  const fixes = state.fixes ?? []
  const openFixes = fixes.filter((f) => f.status === 'open').length
  const fixed = fixes.filter((f) => f.status === 'fixed').length

  const milestones = state.roadmap ?? []
  const msDone = milestones.filter((m) => m.done).length
  const msPercent = milestones.length ? Math.round((100 * msDone) / milestones.length) : 0

  // Health is scored on ACCEPTED work: your checks, or -- with auto-complete
  // on -- everything that works. A protected item breaking is the loudest
  // possible signal either way.
  let health = acceptedPercent
  if (total) {
    health = Math.max(
      0,
      Math.min(
        100,
        Math.round(acceptedPercent - (8 * broken) / Math.max(1, total) - 4 * openFixes - 15 * regressed)
      )
    )
  }

  return {
    total_items: total,
    counts,
    done,
    confirmed,
    unconfirmed,
    confirmed_percent: confirmedPercent,
    auto_complete: auto,
    autopilot: autopilot(state),
    accepted,
    accepted_percent: acceptedPercent,
    by_agents: byAgents,
    complete,
    open,
    protected: protectedCount,
    regressed,
    broken,
    percent,
    open_fixes: openFixes,
    fixed,
    milestones_total: milestones.length,
    milestones_done: msDone,
    milestones_percent: msPercent,
    health,
    version: state.version
  }
}

// --------------------------------------------------------------------------- work queue
// The board's work order, for the IDE's own "now / next" view: finish what is
// in progress, then todo, then open fixes, then broken items; `blocked` is never
// picked. A port of workQueue in agent-bundle/tracker/mcp/work-queue.mjs -- the
// same order agents get from next_task and the resume brief, so what the panel
// says is next and what the agent picks up cannot disagree. The parity test in
// ide/test/mcp-node.test.mjs runs both on the same boards and compares.

/** A `wip` item untouched this long was left behind by an earlier session. */
export const STALE_HOURS = 3

const PRIORITY_RANK: Record<string, number> = {
  urgent: 0, critical: 0, p0: 0, blocker: 0,
  high: 1, p1: 1,
  normal: 2, medium: 2, p2: 2, '': 2,
  low: 3, p3: 3, someday: 3
}

export type QueueItemCard = {
  kind: 'item'
  id: string
  title: string
  status: ItemStatus
  claimed_by: string
  idle: string
  locked?: true
  stale?: true
  priority?: string
  /** Checklist progress, `done/total`, and the step to carry on at. */
  steps?: string
  next_step?: string
  /** The whole checklist -- on the focus only. */
  checklist?: { title: string; status: string }[]
}

export type QueueFixCard = {
  kind: 'fix'
  id: string
  title: string
  problem: string
  logged_by: string
  created_at: string
}

export type QueueLane = 'in_progress' | 'todo' | 'fix' | 'broken'

export type WorkQueue = {
  phase: 'finish' | 'todo' | 'fixes' | 'clear'
  focus: ((QueueItemCard | QueueFixCard) & { lane: QueueLane; action: string }) | null
  alerts: string[]
  counts: {
    in_progress: number
    elsewhere: number
    todo: number
    open_fixes: number
    broken: number
    blocked: number
  }
  in_progress: QueueItemCard[]
  todo: QueueItemCard[]
  open_fixes: QueueFixCard[]
  broken: QueueItemCard[]
  blocked: QueueItemCard[]
  elsewhere: QueueItemCard[]
  order: string
}

const lc = (v: unknown): string => String(v ?? '').trim().toLowerCase()

function ageMs(iso: string, now: number): number {
  const t = Date.parse(iso || '')
  return Number.isFinite(t) ? Math.max(0, now - t) : Number.POSITIVE_INFINITY
}

function idle(ms: number): string {
  if (!Number.isFinite(ms)) return 'unknown'
  const h = ms / 3600e3
  if (h < 1) return `${Math.max(1, Math.round(ms / 60e3))}m`
  if (h < 48) return `${Math.round(h)}h`
  return `${Math.round(h / 24)}d`
}

function clip(s: unknown, n: number): string {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

/** An item's checklist: how far it got and the step to carry on at (checklistOf in work-queue.mjs). */
function checklistOf(i: Item | undefined): { done: number; total: number; next: string; steps: NonNullable<Item['steps']> } | null {
  const raw = i?.steps
  const steps = (Array.isArray(raw) ? raw : []).filter((s) => String(s?.title ?? '').trim())
  if (!steps.length) return null
  const done = steps.filter((s) => s.status === 'done').length
  const next = steps.find((s) => s.status === 'wip') ?? steps.find((s) => s.status !== 'done')
  return { done, total: steps.length, next: next ? String(next.title) : '', steps }
}

function itemCard(i: Item, now: number): QueueItemCard {
  const list = checklistOf(i)
  return {
    kind: 'item',
    id: i.id,
    title: i.title,
    status: i.status,
    claimed_by: i.claimed_by || '',
    idle: idle(ageMs(i.updated_at, now)),
    ...(i.locked ? { locked: true as const } : {}),
    ...(list ? { steps: `${list.done}/${list.total}` } : {}),
    ...(list?.next ? { next_step: clip(list.next, 120) } : {})
  }
}

function withChecklist(card: QueueItemCard, item: Item | undefined): QueueItemCard {
  const list = checklistOf(item)
  if (!list) return card
  return { ...card, checklist: list.steps.map((s) => ({ title: clip(s.title, 120), status: s.status })) }
}

function fixCard(f: Fix): QueueFixCard {
  return {
    kind: 'fix',
    id: f.id,
    title: f.title,
    problem: clip(f.problem, 240),
    logged_by: f.agent || '',
    created_at: f.created_at || ''
  }
}

const ACTION: Record<QueueLane, string> = {
  in_progress:
    'Finish this first. Your plan for it becomes its checklist and closes it when every step is done; or set_item it works/done in the same turn it genuinely works. Then call next_task again.',
  todo: 'Start this: next_task with claim=true (or set_item wip). Your plan for it becomes its checklist and closes it when every step is done; or set_item works/done.',
  fix: 'Fix this, verify it, then mark_fixed with the real solution -- what caused it and what changed.',
  broken: 'Make this work again, then set_item works. Log what caused it with add_fix if it was not logged yet.'
}

export const WORK_ORDER =
  'Finish in_progress first, then todo in order, then open fixes, then broken items. ' +
  'A bug you hit mid-task goes on the board with add_fix (Fixes > Open) and waits its turn -- log it, do not switch to it. ' +
  'blocked waits on someone and is never picked.'

export function workQueue(
  state: Pick<ProjectState, 'items' | 'fixes'>,
  opts: { agent?: string; now?: number; limit?: number; resume?: boolean } = {}
): WorkQueue {
  const now = Number.isFinite(opts.now) ? (opts.now as number) : Date.now()
  const limit = Number.isInteger(opts.limit) && (opts.limit as number) > 0 ? (opts.limit as number) : 5
  const me = lc(opts.agent)
  const resume = opts.resume === true
  const staleMs = STALE_HOURS * 3600e3
  const items = state?.items ?? []
  const fixes = state?.fixes ?? []
  const byId = new Map(items.map((i) => [i.id, i]))

  const wipAll = items
    .filter((i) => i.status === 'wip')
    .map((i) => ({ i, age: ageMs(i.updated_at, now), mine: Boolean(me) && lc(i.claimed_by) === me }))
  const isMineToFinish = (w: { i: Item; age: number; mine: boolean }): boolean =>
    resume || !me || w.mine || !w.i.claimed_by || w.age >= staleMs
  const wip: QueueItemCard[] = wipAll
    .filter(isMineToFinish)
    .sort(resume ? (a, b) => a.age - b.age : (a, b) => Number(b.mine) - Number(a.mine) || b.age - a.age)
    .map((w) => ({ ...itemCard(w.i, now), ...(w.age >= staleMs ? { stale: true as const } : {}) }))
  const elsewhere = wipAll.filter((w) => !isMineToFinish(w)).map((w) => itemCard(w.i, now))

  const rank = (p: string): number => PRIORITY_RANK[lc(p)] ?? PRIORITY_RANK.normal
  const todo: QueueItemCard[] = items
    .map((i, idx) => ({ i, idx }))
    .filter(({ i }) => i.status === 'todo')
    .sort(
      (a, b) =>
        rank(a.i.priority) - rank(b.i.priority) ||
        String(a.i.created_at || '').localeCompare(String(b.i.created_at || '')) ||
        a.idx - b.idx
    )
    .map(({ i }) => ({ ...itemCard(i, now), ...(rank(i.priority) < 2 ? { priority: i.priority } : {}) }))

  // Open is anything not closed -- same as work-queue.mjs (see addFix).
  const openFixes = fixes
    .map((f, idx) => ({ f, idx }))
    .filter(({ f }) => f.status !== 'fixed' && f.status !== 'wontfix')
    .sort((a, b) => String(a.f.created_at || '').localeCompare(String(b.f.created_at || '')) || a.idx - b.idx)
    .map(({ f }) => fixCard(f))

  const broken = items
    .filter((i) => i.status === 'broken')
    .sort((a, b) => Number(Boolean(b.locked)) - Number(Boolean(a.locked)))
    .map((i) => itemCard(i, now))
  const blocked = items.filter((i) => i.status === 'blocked').map((i) => itemCard(i, now))
  const regressed = items
    .filter((i) => i.locked && (i.status === 'broken' || i.status === 'blocked'))
    .map((i) => itemCard(i, now))

  let focus: WorkQueue['focus'] = null
  let phase: WorkQueue['phase'] = 'clear'
  if (wip.length) {
    focus = { lane: 'in_progress', ...withChecklist(wip[0], byId.get(wip[0].id)), action: ACTION.in_progress }
    phase = 'finish'
  } else if (todo.length) {
    focus = { lane: 'todo', ...withChecklist(todo[0], byId.get(todo[0].id)), action: ACTION.todo }
    phase = 'todo'
  } else if (openFixes.length) {
    focus = { lane: 'fix', ...openFixes[0], action: ACTION.fix }
    phase = 'fixes'
  } else if (broken.length) {
    focus = { lane: 'broken', ...withChecklist(broken[0], byId.get(broken[0].id)), action: ACTION.broken }
    phase = 'fixes'
  }

  return {
    phase,
    focus,
    alerts: regressed.map(
      (r) => `REGRESSION: protected "${r.title}" [${r.id}] is ${r.status} -- tell the user before anything else.`
    ),
    counts: {
      in_progress: wip.length,
      elsewhere: elsewhere.length,
      todo: todo.length,
      open_fixes: openFixes.length,
      broken: broken.length,
      blocked: blocked.length
    },
    in_progress: wip.slice(0, limit),
    todo: todo.slice(0, limit),
    open_fixes: openFixes.slice(0, limit),
    broken: broken.slice(0, limit),
    blocked: blocked.slice(0, limit),
    elsewhere: elsewhere.slice(0, limit),
    order: WORK_ORDER
  }
}
