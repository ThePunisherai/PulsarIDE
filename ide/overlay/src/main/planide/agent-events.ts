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
 *  * Activity only. It never creates, moves or closes items — an agent finishing
 *    a turn is not evidence that anything works, and auto-filling the board with
 *    guesses is exactly the "green board nobody checked" problem this project
 *    exists to avoid. Promoting a turn into an item stays your call.
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
import { addItem, loadState, logActivity, nowIso, saveState, statePath } from './store'
import { historySnapshot, recordHistory } from './history'

/** What the caller passes through from Orca's agent hook listener. */
export type AgentTurn = {
  /** Orca worktree id, shaped `${repoId}::${path}`. */
  worktreeId?: string
  paneKey?: string
  isReplay?: boolean
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

/** Normalise a title for dedup: lowercase, punctuation to spaces, collapsed. */
function normalizeTitle(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

/**
 * Put the agent's work on the board, honestly.
 *
 * The passive trail above records that an agent finished a turn, but it only
 * ever wrote the Activity log -- so the board's own columns never moved unless
 * the agent chose to call the MCP, which models do inconsistently. Reported, in
 * as many words and more than once: "agents write nothing to the tracker, I see
 * no changes." This closes that gap from the side the IDE actually controls: the
 * same hook that already fires reliably (it drives the memory graph) now also
 * reflects the work as a board item.
 *
 * Kept deliberately honest and quiet:
 *  - The title is the user's OWN prompt, so this is a faithful record of what was
 *    asked, never a guess about what works. Status is `wip` (in progress) and
 *    never `works`/`done` -- confirming something functions stays the agent's or
 *    the user's explicit call, so this can never green-wash the board.
 *  - Deduped against the open board by normalised title, so a multi-turn task on
 *    the same prompt is one item, and an existing `todo` an agent starts working
 *    is advanced to `wip` rather than duplicated.
 *  - Only a real task-shaped prompt (two+ words) qualifies, and creation stops
 *    at MAX_AGENT_ITEMS, so idle chatter and long sessions cannot flood it.
 */
function reflectPromptOnBoard(state: ReturnType<typeof loadState>, prompt: string, agent: string): void {
  const title = prompt.trim()
  const norm = normalizeTitle(title)
  // A task, not a greeting: at least two words and enough substance to matter.
  if (norm.length < 10 || norm.split(' ').length < 2) return

  const open = (state.items ?? []).filter((i) => OPEN_STATUSES.includes(i.status))
  const match = open.find((i) => {
    const n = normalizeTitle(i.title)
    if (n === norm) return true
    // Strong containment only, and only for titles long enough that containment
    // is meaningful -- so "fix" does not swallow "fix the login form".
    return n.length >= 12 && norm.length >= 12 && (n.includes(norm) || norm.includes(n))
  })
  if (match) {
    // An agent is actively working a planned item -> move it into `wip`.
    if (match.status === 'todo') {
      match.status = 'wip'
      match.updated_at = nowIso()
      if (!match.claimed_by) match.claimed_by = agent
    }
    return
  }
  if (open.filter((i) => (i.tags ?? []).includes('agent')).length >= MAX_AGENT_ITEMS) return
  addItem(state, {
    title: title.length > 120 ? `${title.slice(0, 119)}…` : title,
    status: 'wip',
    tags: ['agent'],
    claimedBy: agent
  })
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
    if (payload.state !== 'done') return false
    // A session boundary is an agent connecting or being cleared, not work.
    if (payload.sessionBoundary === true) return false

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
    // A finished, uninterrupted turn on a real prompt also moves the board, so
    // agent work is visible as a card and not only as a line in the trail.
    if (prompt && !payload.interrupted) {
      reflectPromptOnBoard(state, prompt, agent)
    }
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
}
