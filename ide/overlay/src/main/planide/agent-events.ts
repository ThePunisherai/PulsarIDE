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
 *  * Only projects you already track. A workspace with no `.planide/state.json`
 *    is left alone, so merely using an agent never litters a repo with tracker
 *    files you did not ask for.
 *  * Real completions only. Replays, session boundaries and duplicate hook
 *    deliveries are all dropped (see the guards in recordAgentTurn).
 *
 * A remote (SSH) workspace carries a path on the remote host, which does not
 * exist locally — so the "only projects you already track" check simply finds no
 * state file and this stays silent, rather than writing somewhere wrong.
 */

import { existsSync } from 'node:fs'
import { loadState, logActivity, saveState, statePath } from './store'

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
    // Only projects you already track: never create tracker state as a side
    // effect of running an agent.
    if (!existsSync(statePath(path))) return false

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
    logActivity(state, payload.interrupted ? 'agent-interrupted' : 'agent-turn', `${verb}${detail}`, agent)
    // The agent's own closing summary is the most useful line it produces; keep
    // it as a separate entry so the trail reads as a conversation, not a blob.
    if (summary && !payload.interrupted) {
      logActivity(state, 'agent-said', summary, agent)
    }
    saveState(path, state)
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
