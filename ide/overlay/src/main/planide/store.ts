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

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
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
  /** You confirmed it works. Never set by an agent. */
  verified: boolean
  verified_at: string
  /** "Do not break this." Never set by an agent. */
  locked: boolean
  locked_at: string
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
}

export type Progress = {
  total_items: number
  counts: Record<string, number>
  done: number
  confirmed: number
  unconfirmed: number
  confirmed_percent: number
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
    activity: []
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
    item.locked ??= false
    item.locked_at ??= ''
    item.tags ??= []
    item.notes ??= ''
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
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  renameSync(tmp, file)
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
 * Deliberately cannot set `verified` or `locked`: those are yours, and an agent
 * calling this must not be able to confirm its own work or unprotect what it is
 * about to change. Changing the status drops a confirmation, because what you
 * confirmed is no longer what the item says.
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
  }
  // Runtime allowlist, not just the TypeScript signature: this is reachable over
  // IPC with arbitrary JSON, so `verified` and `locked` must be impossible to
  // slip in here -- that is the whole trust boundary.
  const WRITABLE = new Set(['title', 'status', 'notes', 'tags', 'priority', 'claimed_by'])
  for (const [k, v] of Object.entries(fields)) {
    if (!WRITABLE.has(k)) continue
    if (k === 'status' && !(ITEM_STATUSES as readonly string[]).includes(v as string)) continue
    ;(item as unknown as Record<string, unknown>)[k] = v
  }
  item.updated_at = nowIso()
  if (fields.status !== undefined) {
    const who = fields.claimed_by || item.claimed_by || 'you'
    const note = item.locked && OPEN_BAD.includes(item.status) ? ' (was protected -- REGRESSION)' : ''
    logActivity(state, 'item-status', `${item.title} -> ${item.status}${note}`, who)
  }
  return item
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
  const status = (['open', 'fixed', 'wontfix'] as const).includes(opts.status ?? 'open')
    ? (opts.status as Fix['status'])
    : 'open'
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
  const WRITABLE = new Set(['title', 'problem', 'solution', 'item_id', 'agent', 'status'])
  for (const [k, v] of Object.entries(fields)) {
    if (!WRITABLE.has(k)) continue
    ;(fix as unknown as Record<string, unknown>)[k] = v
  }
  if (fields.status === 'fixed' && !fix.fixed_at) {
    fix.fixed_at = nowIso()
    logActivity(state, 'fix-done', `fixed: ${fix.title}`, fix.agent || 'you')
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
  const working = items.filter((i) => DONE_ITEM.includes(i.status))
  const confirmed = working.filter((i) => i.verified).length
  const unconfirmed = working.length - confirmed
  const confirmedPercent = total ? Math.round((100 * confirmed) / total) : 0

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

  // Health is scored on CONFIRMED work: a board where everything says "works"
  // but nothing is confirmed is unverified, not healthy. A protected item
  // breaking is the loudest possible signal.
  let health = confirmedPercent
  if (total) {
    health = Math.max(
      0,
      Math.min(
        100,
        Math.round(confirmedPercent - (8 * broken) / Math.max(1, total) - 4 * openFixes - 15 * regressed)
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
