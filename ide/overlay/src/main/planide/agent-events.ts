/**
 * Agent turns, recorded automatically.
 *
 * Orca already knows when an agent starts and finishes a turn in a workspace —
 * that is what drives the status dots. This listens to the same signal and
 * writes each finished turn into that project's tracker, attributed to the
 * agent that ran it. Nothing has to be called by the agent itself, so the
 * Activity trail is complete even for agents that never touch the CLI or MCP.
 *
 * Deliberately conservative about what it writes:
 *
 *  * A card only while a turn runs. When an agent starts a turn on a real task,
 *    what you asked for shows as "In progress" -- true, because an agent is on
 *    it. When the turn ends, that card has to stop claiming so: a card the
 *    agent never touched is removed (the turn stays in Activity, with your prompt
 *    and the agent's closing words), and an existing to-do the turn picked up
 *    goes back to `todo` with a note. It never marks anything working or done --
 *    a finished turn is not evidence that anything works.
 *  * Local projects only. The board is created on the first real turn an agent
 *    finishes in a workspace, so the trail is there without setting anything up
 *    first. A remote (SSH) worktree's path does not exist on this machine, so
 *    this stays silent there rather than writing the board somewhere wrong.
 *  * Real completions only. Replays, session boundaries and duplicate hook
 *    deliveries are all dropped (see the guards in recordAgentTurn).
 *
 * A remote (SSH) workspace carries a path on the remote host, which does not
 * exist locally — so the "only projects you already track" check simply finds no
 * state file and this stays silent, rather than writing somewhere wrong.
 */

import { existsSync } from 'node:fs'
import { addItem, loadState, logActivity, nowIso, saveState, statePath, type Item } from './store'
import { historySnapshot, recordHistory } from './history'

/** What the caller passes through from Orca's agent hook listener. */
export type AgentTurn = {
  /** Orca worktree id, shaped `${repoId}::${path}`. */
  worktreeId?: string
  paneKey?: string
  isReplay?: boolean
  /**
   * When the main agent's current turn began, stamped by Orca's hook server
   * (ms). Absent from older hosts and from turns it saw open unseen -- the card
   * then carries the start we observed ourselves.
   */
  turnStartedAt?: number
  /**
   * Orca's own per-turn identity, when the agent's hook source exposes enough
   * context to produce one. Upstream's stated purpose is exactly our problem:
   * telling duplicate hook delivery apart from a rerun of the same prompt.
   */
  promptInteractionKey?: string
  payload: {
    state?: string
    prompt?: string
    agentType?: string
    interrupted?: boolean
    lastAssistantMessage?: string
    turnCompletedAt?: number
    /**
     * Upstream marks a `done` that is only a session boundary (connect, resume,
     * clear) rather than a finished turn, and its own docs tell consumers that
     * react to completions to ignore it — which is precisely what this is.
     */
    sessionBoundary?: boolean
  }
}

/** How much of a prompt or summary is worth keeping in the trail. */
const MAX_TEXT = 160
/** Remember the last turn per pane so a duplicate delivery is not logged twice. */
const lastTurnByPane = new Map<string, { fingerprint: string; at: number }>()
const PANE_CACHE_CAP = 200
/**
 * Without a per-turn key from upstream, identical text is only treated as a
 * duplicate when it lands in the same breath. Duplicate hook delivery is
 * immediate; deliberately rerunning the same prompt takes longer than this, so
 * a real second run still gets its own line.
 */
const DEDUPE_WINDOW_MS = 10_000

/**
 * Recover the project path from a worktree id.
 * The id is `${repoId}::${path}`, and a repo id never contains "::", so the
 * path is everything after the first separator — kept intact even if the path
 * itself contains one. Both halves must be non-empty, matching how upstream's
 * own parser (`parsePtySessionId`) rejects degenerate ids.
 */
export function projectPathFromWorktreeId(worktreeId: string | undefined): string | null {
  if (!worktreeId) return null
  const idx = worktreeId.indexOf('::')
  if (idx <= 0) return null
  const path = worktreeId.slice(idx + 2)
  return path.length ? path : null
}

function trim(text: string | undefined): string {
  const value = (text ?? '').replace(/\s+/g, ' ').trim()
  if (!value) return ''
  return value.length > MAX_TEXT ? `${value.slice(0, MAX_TEXT - 1)}…` : value
}

/** True when this turn has already been written for this pane. */
function isDuplicate(paneKey: string, fingerprint: string, authoritative: boolean, now: number): boolean {
  const seen = lastTurnByPane.get(paneKey)
  const duplicate =
    seen !== undefined &&
    seen.fingerprint === fingerprint &&
    (authoritative || now - seen.at < DEDUPE_WINDOW_MS)
  lastTurnByPane.set(paneKey, { fingerprint, at: now })
  if (lastTurnByPane.size > PANE_CACHE_CAP) {
    // Bounded: drop the oldest insertion rather than growing forever.
    const oldest = lastTurnByPane.keys().next().value
    if (oldest !== undefined && oldest !== paneKey) lastTurnByPane.delete(oldest)
  }
  return duplicate
}

/** The board columns that count as "still open" for dedup. */
const OPEN_STATUSES = ['todo', 'wip', 'broken']
/** Never grow the board past this many auto-captured items -- a runaway guard. */
const MAX_AGENT_ITEMS = 60

/**
 * Normalise a title for dedup: case, punctuation, spacing and accents ignored,
 * letters of every script kept. The same rule the plan hook and the MCP server
 * use, so one piece of work is one card whichever route wrote it.
 */
export function normalizeTitle(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/** The turn each pane is in, so the many `working` pings of one turn place its card once. */
const openTurnByPane = new Map<string, string>()

function isoSeconds(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

/** A task, not a greeting: at least two words and enough substance to matter. */
function isTaskPrompt(prompt: string): boolean {
  const norm = normalizeTitle(prompt)
  return norm.length >= 10 && norm.split(' ').length >= 2
}

/** The open item a prompt is about, if there is one. */
function matchOpenItem(state: ReturnType<typeof loadState>, prompt: string): Item | undefined {
  const norm = normalizeTitle(prompt)
  return (state.items ?? []).find((i) => {
    if (!OPEN_STATUSES.includes(i.status)) return false
    const n = normalizeTitle(i.title)
    if (n === norm) return true
    // Strong containment only, and only for titles long enough that containment
    // is meaningful -- so "fix" does not swallow "fix the login form".
    return n.length >= 12 && norm.length >= 12 && (n.includes(norm) || norm.includes(n))
  })
}

/**
 * Put the turn's work on the board as it starts: the matching to-do moves to
 * `wip`, or a card with your prompt appears in `wip`. Either way the item is
 * marked as held by this pane, so the turn's end can let go of exactly it.
 */
function holdCardForTurn(
  state: ReturnType<typeof loadState>,
  prompt: string,
  agent: string,
  paneKey: string,
  startedAt: string
): boolean {
  const match = matchOpenItem(state, prompt)
  if (match) {
    // Someone else's work in progress, or something broken: not ours to take.
    if (match.status !== 'todo' || match.locked) return false
    match.status = 'wip'
    match.updated_at = nowIso()
    if (!match.claimed_by) match.claimed_by = agent
    match.held_by = paneKey
    match.held_since = startedAt
    return true
  }
  const open = (state.items ?? []).filter((i) => OPEN_STATUSES.includes(i.status))
  if (open.filter((i) => (i.tags ?? []).includes('agent')).length >= MAX_AGENT_ITEMS) return false
  const title = prompt.trim()
  const card = addItem(state, {
    title: title.length > 120 ? `${title.slice(0, 119)}…` : title,
    status: 'wip',
    tags: ['agent'],
    claimedBy: agent
  })
  card.held_by = paneKey
  card.held_since = startedAt
  card.held_new = true
  return true
}

/**
 * The turn is over: let go of what it held. Returns how many items changed.
 *
 *  - Moved by the agent or by you (no longer `wip`): stays exactly where it was
 *    put. That is the agent picking the card up, which is the whole idea.
 *  - A card this turn created and nobody touched: removed. It stood for "an
 *    agent is on this" and that is no longer true; the turn itself stays in
 *    Activity with your prompt and the agent's closing words.
 *  - Anything else still in `wip` -- a to-do the turn picked up, a card someone
 *    wrote to and left in progress: back to `todo`, with a dated note saying what
 *    happened, so the next agent sees it as open work rather than taken.
 */
function releaseTurn(
  state: ReturnType<typeof loadState>,
  paneKey: string,
  agent: string,
  ended: 'finished' | 'interrupted' | 'lost',
  summary: string
): number {
  let changed = 0
  for (const item of [...(state.items ?? [])]) {
    if (item.held_by !== paneKey) continue
    const createdByTurn = item.held_new === true
    delete item.held_by
    delete item.held_since
    delete item.held_new
    changed += 1
    if (item.status !== 'wip' || item.locked) continue
    // Removed only if nobody wrote to it after it went up: an agent that picked
    // the card up with set_item holds its id, and deleting it from under that
    // agent would make its closing update fail.
    const untouched = item.updated_at === item.created_at && !item.notes
    if (createdByTurn && untouched) {
      state.items = state.items.filter((i) => i !== item)
      for (const m of state.roadmap ?? []) m.item_ids = (m.item_ids ?? []).filter((id) => id !== item.id)
      continue
    }
    item.status = 'todo'
    item.updated_at = nowIso()
    const said = summary ? ` It said: "${summary}"` : ''
    const line =
      ended === 'interrupted'
        ? `${agent}'s turn on this was interrupted before it finished.`
        : ended === 'lost'
          ? `${agent}'s turn on this ended without the IDE seeing it finish.`
          : `${agent} finished a turn on this without moving it to works/done.${said}`
    const stamped = `[${nowIso().slice(0, 16).replace('T', ' ')}] ${line}`
    item.notes = item.notes ? `${item.notes}\n${stamped}` : stamped
  }
  return changed
}

/**
 * A turn starts: the agent is on it, so the board says so -- now, while it is
 * true, rather than after the fact.
 */
function startTurn(turn: AgentTurn): boolean {
  const payload = turn.payload ?? {}
  const prompt = trim(payload.prompt)
  if (!prompt || !isTaskPrompt(prompt)) return false
  const path = projectPathFromWorktreeId(turn.worktreeId)
  if (!path || !existsSync(path)) return false
  const paneKey = turn.paneKey ?? path
  // One card per turn: `working` is re-reported on every tool call.
  const turnId = `${turn.turnStartedAt ?? ''}|${prompt}`
  if (openTurnByPane.get(paneKey) === turnId) return false
  openTurnByPane.set(paneKey, turnId)
  if (openTurnByPane.size > PANE_CACHE_CAP) {
    const oldest = openTurnByPane.keys().next().value
    if (oldest !== undefined && oldest !== paneKey) openTurnByPane.delete(oldest)
  }
  const agent = trim(payload.agentType) || 'agent'
  const state = loadState(path)
  const before = historySnapshot(state)
  const startedAt = turn.turnStartedAt ? isoSeconds(turn.turnStartedAt) : nowIso()
  const held = (state.items ?? []).filter((i) => i.held_by === paneKey)
  // This very turn is already on the board -- the IDE restarted mid-turn and
  // forgot it had placed the card. Keep it.
  if (held.some((i) => i.held_since === startedAt)) return false
  // A pane still holding a card from an EARLIER turn whose end never reached us
  // (a lost delivery, the IDE closed mid-turn): that turn is over now.
  const released = held.length ? releaseTurn(state, paneKey, agent, 'lost', '') : 0
  const placed = holdCardForTurn(state, prompt, agent, paneKey, startedAt)
  if (!placed && !released) return false
  saveState(path, state)
  recordHistory(path, before, state, agent)
  return true
}

/**
 * Record a finished agent turn in its project's tracker.
 * Returns true when something was written — the rest of the time this is a
 * deliberate no-op (wrong state, replay, duplicate, or an untracked project).
 */
export function recordAgentTurn(turn: AgentTurn): boolean {
  try {
    if (turn.isReplay) return false
    const payload = turn.payload ?? {}
    // A session boundary is an agent connecting or being cleared, not work.
    if (payload.sessionBoundary === true) return false
    if (payload.state === 'working') return startTurn(turn)
    if (payload.state !== 'done') return false

    const path = projectPathFromWorktreeId(turn.worktreeId)
    if (!path) return false
    // The board starts itself on the first real turn an agent finishes here.
    //
    // This used to require `.planide/state.json` to already exist, so a project
    // you never opened the Tracker tab in recorded nothing, ever -- you ran a
    // whole task through an agent and the tracker stayed empty ("wordt niets
    // aangemaakt"). That guard was there so merely running an agent could not
    // litter a repo with tracker files, but it made the automatic trail useless
    // for exactly the case it exists for: work you did not think to set up first.
    //
    // The directory check is what keeps it honest: a remote (SSH) worktree's
    // path does not exist on this machine, so this still stays silent there
    // instead of writing the board somewhere wrong.
    if (!existsSync(statePath(path)) && !existsSync(path)) return false

    const agent = trim(payload.agentType) || 'agent'
    const prompt = trim(payload.prompt)
    const summary = trim(payload.lastAssistantMessage)

    const key = turn.promptInteractionKey
    const fingerprint = key
      ? `k:${key}`
      : `t:${payload.turnCompletedAt ?? ''}|${agent}|${prompt}|${payload.interrupted ? 'x' : ''}`
    if (isDuplicate(turn.paneKey ?? path, fingerprint, Boolean(key), Date.now())) return false

    const verb = payload.interrupted ? 'turn interrupted' : 'finished a turn'
    const detail = prompt ? `: ${prompt}` : ''
    const state = loadState(path)
    const before = historySnapshot(state)
    logActivity(state, payload.interrupted ? 'agent-interrupted' : 'agent-turn', `${verb}${detail}`, agent)
    // The agent's own closing summary is the most useful line it produces; keep
    // it as a separate entry so the trail reads as a conversation, not a blob.
    if (summary && !payload.interrupted) {
      logActivity(state, 'agent-said', summary, agent)
    }
    // Whatever this turn held on the board, it holds no longer.
    const paneKey = turn.paneKey ?? path
    releaseTurn(state, paneKey, agent, payload.interrupted ? 'interrupted' : 'finished', summary)
    openTurnByPane.delete(paneKey)
    saveState(path, state)
    // Record any board change this turn made (a new/advanced card) in the
    // per-project history DB, attributed to the agent. Best-effort, never throws.
    recordHistory(path, before, state, agent)
    return true
  } catch {
    // A tracker problem must never disturb Orca's agent pipeline.
    return false
  }
}

/** Test seam: forget the per-pane dedupe cache. */
export function resetAgentTurnCache(): void {
  lastTurnByPane.clear()
  openTurnByPane.clear()
}
