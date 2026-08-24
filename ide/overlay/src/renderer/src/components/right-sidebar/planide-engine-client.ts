/**
 * Renderer-side client for the PlanIDE tracker.
 *
 * Thin wrapper over the preload bridge (`window.api.planide`), which calls
 * straight into the main-process tracker. No HTTP, no port, no server: the
 * tracker is part of the IDE, and a project is addressed by its own path.
 *
 * Every mutating call returns the refreshed project, so a caller updates its
 * state from one round-trip instead of a write followed by a re-read.
 */

export type ItemStatus = 'todo' | 'wip' | 'works' | 'broken' | 'blocked' | 'done'

export type PlanIdeProgress = {
  total_items: number
  counts: Record<string, number>
  done: number
  /** Items you confirmed actually work (never set by an agent). */
  confirmed: number
  /** Reported working but not confirmed by you yet. */
  unconfirmed: number
  confirmed_percent: number
  /** Finished and closed out. */
  complete: number
  /** Still to be done (todo + wip). */
  open: number
  /** Marked "do not break". */
  protected: number
  /** Protected items that are currently broken -- the loudest signal there is. */
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

export type PlanIdeItem = {
  id: string
  title: string
  /** `works` = it functions; `done` = finished and closed out. */
  status: ItemStatus
  notes: string
  tags: string[]
  priority: string
  /** True only when YOU confirmed it -- agents cannot set this. */
  verified: boolean
  verified_at: string
  /** Who reported this (agent name), empty when you entered it yourself. */
  claimed_by: string
  /** "Do not break this" -- protected by you. Agents read it, never set it. */
  locked: boolean
  locked_at: string
}

export type PlanIdeFix = {
  id: string
  title: string
  problem: string
  solution: string
  agent: string
  status: 'open' | 'fixed' | 'wontfix'
}

export type PlanIdeActivity = {
  id: string
  at: string
  kind: string
  text: string
  /** "you" for your own actions, otherwise the agent that did it. */
  who: string
}

export type PlanIdeMilestone = { id: string; title: string; target: string; done: boolean }

export type PlanIdeVersion = {
  version: string
  date: string
  notes: string
  added: string[]
  fixed: string[]
  changed: string[]
}

export type PlanIdeDetected = {
  languages?: string[]
  stack?: string[]
  type?: string
  confidence?: string
  signals?: string[]
}

export type PlanIdeProject = {
  id: string
  name: string
  path: string
  type: string
  version: string
  progress: PlanIdeProgress
  items: PlanIdeItem[]
  fixes: PlanIdeFix[]
  roadmap: PlanIdeMilestone[]
  versions: PlanIdeVersion[]
  activity: PlanIdeActivity[]
  /** Protected items that are currently broken. */
  regressions: PlanIdeItem[]
  stack?: { detected?: PlanIdeDetected; custom?: string }
  github?: {
    remote: string
    branch: string
    lfs: boolean
    /** Commit + push by itself once changes settle. Off by default. */
    auto_push: boolean
    last_sync: string
  }
}

export type GitStatus = {
  ok: boolean
  has_git: boolean
  path: string
  branch?: string
  dirty?: boolean
  changed_count?: number
  remote?: string
  ahead?: number
  behind?: number
  last_commit?: string
}

export type LargeFileScan = {
  ok: boolean
  threshold_mb: number
  count: number
  files: { path: string; size_mb: number; ext: string }[]
  extensions: string[]
}

export type SyncResult = {
  ok: boolean
  committed: boolean
  pushed: boolean
  branch: string
  log: string[]
  push_error: string
}

export type BackupInfo = { file: string; size: number; size_mb: number; created_at: string }

/** Per-project memory: the knowledge graph (Brain Graph) + the Obsidian notes. */
export type GraphHub = { id: string; label: string; degree: number; file: string }
export type NamedCount = { name: string; count: number }

export type BrainGraph = {
  available: boolean
  nodes: number
  edges: number
  communities: number
  indexedFiles: number
  hubs: GraphHub[]
  relations: NamedCount[]
  confidence: NamedCount[]
  kinds: NamedCount[]
  updatedAt: number | null
  hasReport: boolean
  hasHtml: boolean
  tooLarge: boolean
  sizeBytes: number
}

export type ObsidianNote = { name: string; path: string; updatedAt: number | null }

export type ObsidianStatus = {
  vault: string | null
  source: 'setting' | 'env' | 'detected' | null
  noteExists: boolean
  notePath: string | null
  updatedAt: number | null
  excerpt: string
  notes: ObsidianNote[]
}

export type MemoryStatus = { graphify: BrainGraph; obsidian: ObsidianStatus }

type Reply<T> = { ok: boolean; data?: T; error?: string }

type PlanIdeBridge = Record<string, (...args: never[]) => Promise<Reply<unknown>>>

/** The preload bridge, or null when running outside the desktop shell. */
function bridge(): PlanIdeBridge | null {
  const api = (globalThis as unknown as { api?: { planide?: PlanIdeBridge } }).api
  return api?.planide ?? null
}

async function call<T>(method: string, ...args: unknown[]): Promise<T> {
  const api = bridge()
  if (!api) throw new Error('PulsarIDE is unavailable (not running in the desktop app)')
  const fn = api[method]
  if (typeof fn !== 'function') throw new Error(`PulsarIDE bridge is missing "${method}"`)
  const reply = (await (fn as (...a: unknown[]) => Promise<Reply<T>>)(...args)) as Reply<T>
  if (!reply?.ok) throw new Error(reply?.error || `${method} failed`)
  return reply.data as T
}

// --------------------------------------------------------------------------- project
/** Load (creating on first use) the tracker for a project path. */
export function openProject(path: string): Promise<PlanIdeProject> {
  return call<PlanIdeProject>('open', path)
}

export function redetect(path: string): Promise<PlanIdeProject> {
  return call<PlanIdeProject>('redetect', path)
}

// --------------------------------------------------------------------------- items
export function addItem(
  path: string,
  opts: { title: string; status?: ItemStatus; notes?: string; priority?: string; tags?: string[] }
): Promise<{ result: PlanIdeItem; payload: PlanIdeProject }> {
  return call<{ result: PlanIdeItem; payload: PlanIdeProject }>('addItem', path, opts)
}

export function updateItem(
  path: string,
  itemId: string,
  fields: Partial<Pick<PlanIdeItem, 'title' | 'notes' | 'status' | 'priority'>>
): Promise<PlanIdeProject> {
  return call<PlanIdeProject>('updateItem', path, itemId, fields)
}

export function setItemStatus(
  path: string,
  itemId: string,
  status: ItemStatus
): Promise<PlanIdeProject> {
  return call<PlanIdeProject>('updateItem', path, itemId, { status })
}

export function deleteItem(path: string, itemId: string): Promise<PlanIdeProject> {
  return call<PlanIdeProject>('deleteItem', path, itemId)
}

/**
 * Confirm (or withdraw confirmation) that an item really works.
 * Yours alone: nothing agent-facing can reach this, so "an agent says it works"
 * can never masquerade as "you saw it work".
 */
export function verifyItem(
  path: string,
  itemId: string,
  verified: boolean
): Promise<PlanIdeProject> {
  return call<PlanIdeProject>('verifyItem', path, itemId, verified)
}

/**
 * Protect an item: "this works and must NOT be broken".
 * Yours alone too — an agent must never unprotect what it is about to refactor.
 */
export function lockItem(path: string, itemId: string, locked: boolean): Promise<PlanIdeProject> {
  return call<PlanIdeProject>('lockItem', path, itemId, locked)
}

// --------------------------------------------------------------------------- fixes
export function addFix(
  path: string,
  opts: { title: string; problem?: string; solution?: string; agent?: string }
): Promise<PlanIdeProject> {
  return call<PlanIdeProject>('addFix', path, opts)
}

export function markFixDone(path: string, fixId: string): Promise<PlanIdeProject> {
  return call<PlanIdeProject>('updateFix', path, fixId, { status: 'fixed' })
}

// --------------------------------------------------------------------------- roadmap + versions
export function addMilestone(path: string, title: string, target = ''): Promise<PlanIdeProject> {
  return call<PlanIdeProject>('addMilestone', path, title, target)
}

export function toggleMilestone(
  path: string,
  mid: string,
  done: boolean
): Promise<PlanIdeProject> {
  return call<PlanIdeProject>('updateMilestone', path, mid, { done })
}

export function addVersion(
  path: string,
  version: string,
  opts: { notes?: string; added?: string[]; fixed?: string[]; changed?: string[] } = {}
): Promise<PlanIdeProject> {
  return call<PlanIdeProject>('addVersion', path, version, opts)
}

// --------------------------------------------------------------------------- briefing
export function aiReport(path: string, mode = 'full'): Promise<string> {
  return call<string>('report', path, mode)
}

// --------------------------------------------------------------------------- memory
export function memoryStatus(path: string): Promise<MemoryStatus> {
  return call<MemoryStatus>('memoryStatus', path)
}

// --------------------------------------------------------------------------- live
/**
 * Subscribe to board changes pushed from the main process (an agent wrote the
 * project's state.json). Returns an unsubscribe; a no-op outside the desktop
 * shell, so a surface can always call it unconditionally.
 */
export function onBoardChanged(listener: (path: string) => void): () => void {
  const api = bridge() as unknown as { onBoardChanged?: (l: (p: string) => void) => () => void } | null
  if (!api?.onBoardChanged) return () => {}
  return api.onBoardChanged(listener)
}

// --------------------------------------------------------------------------- git
export function gitStatus(path: string): Promise<GitStatus> {
  return call<GitStatus>('gitStatus', path)
}

export function gitInit(path: string, branch = 'main'): Promise<{ ok: boolean; message?: string }> {
  return call<{ ok: boolean; message?: string }>('gitInit', path, branch)
}

export function gitSetRemote(path: string, url: string): Promise<{ ok: boolean; remote: string }> {
  return call<{ ok: boolean; remote: string }>('gitSetRemote', path, url)
}

export function gitLargeFiles(path: string, mb = 25): Promise<LargeFileScan> {
  return call<LargeFileScan>('gitLargeFiles', path, mb)
}

export function gitLfs(
  path: string,
  patterns: string[]
): Promise<{ ok: boolean; installed: boolean; tracked?: string[]; error?: string }> {
  return call('gitLfs', path, patterns)
}

export function gitSync(
  path: string,
  opts: { message?: string; push?: boolean } = {}
): Promise<SyncResult> {
  return call<SyncResult>('gitSync', path, opts)
}

/** Push by itself after a change, debounced. Off unless you turn it on. */
export function gitAutoPush(path: string, enabled: boolean): Promise<PlanIdeProject> {
  return call<PlanIdeProject>('gitAutoPush', path, enabled)
}

// --------------------------------------------------------------------------- backups
export function backupCreate(
  path: string,
  label = ''
): Promise<{ ok: boolean; file?: string; files?: number; size_mb?: number; error?: string }> {
  return call('backupCreate', path, label)
}

export function backupList(path: string): Promise<BackupInfo[]> {
  return call<BackupInfo[]>('backupList', path)
}

export function backupDelete(path: string, file: string): Promise<{ ok: boolean }> {
  return call<{ ok: boolean }>('backupDelete', path, file)
}
