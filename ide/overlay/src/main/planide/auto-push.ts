/**
 * Push without being asked.
 *
 * The state has carried `github.auto_push` and `github.last_sync` since the
 * first version and nothing ever read them. This is that switch, wired: when it
 * is on, a change to the tracker arms a timer, and when the timer fires the
 * project is committed and pushed with the tracker state inside it.
 *
 * Deliberately debounced rather than immediate. A work session is dozens of
 * small changes — one push per change would be a useless commit log and a lot of
 * network. The timer restarts on every change, so the push lands once things go
 * quiet.
 *
 * Nothing here throws: an auto-push is a convenience, and a failing one must not
 * take down the IPC call that happened to trigger it. It logs to the project's
 * own activity trail instead, so a silent failure is still visible.
 */

import { loadState, logActivity, nowIso, saveState, type ProjectState } from './store'
import { sync as gitSync, type SyncResult } from './git'

/** Long enough to batch a burst of edits, short enough to still be a backup. */
export const AUTO_PUSH_DELAY_MS = 90_000

type Runner = (path: string, opts: { message?: string; push?: boolean }) => Promise<SyncResult>

const timers = new Map<string, ReturnType<typeof setTimeout>>()

export function autoPushEnabled(state: ProjectState): boolean {
  return state.github?.auto_push === true
}

/** Turn it on or off for a project, cancelling anything already armed. */
export function setAutoPush(state: ProjectState, enabled: boolean, path?: string): boolean {
  state.github = {
    ...(state.github ?? { remote: '', branch: 'main', lfs: false, auto_push: false, last_sync: '' }),
    auto_push: enabled
  }
  logActivity(state, 'auto-push', enabled ? 'auto-push on' : 'auto-push off')
  if (!enabled && path) cancelAutoPush(path)
  return enabled
}

export function cancelAutoPush(path: string): void {
  const timer = timers.get(path)
  if (timer) {
    clearTimeout(timer)
    timers.delete(path)
  }
}

/**
 * Arm (or re-arm) the push for a project. Returns whether it is now armed —
 * false means auto-push is off, which is the common case.
 */
export function scheduleAutoPush(
  path: string,
  state: ProjectState,
  opts: { delayMs?: number; run?: Runner } = {}
): boolean {
  if (!autoPushEnabled(state)) {
    cancelAutoPush(path)
    return false
  }
  cancelAutoPush(path)
  const timer = setTimeout(() => {
    timers.delete(path)
    void runAutoPush(path, opts.run)
  }, opts.delayMs ?? AUTO_PUSH_DELAY_MS)
  // Never hold the app open just to push later.
  ;(timer as unknown as { unref?: () => void }).unref?.()
  timers.set(path, timer)
  return true
}

/** Commit and push now, recording the outcome where you will see it. */
export async function runAutoPush(path: string, run: Runner = gitSync): Promise<boolean> {
  try {
    const state = loadState(path)
    // Checked again at fire time: the switch may have been turned off while the
    // timer was running.
    if (!autoPushEnabled(state)) return false

    const result = await run(path, { message: 'PulsarIDE: auto-sync', push: true })
    const fresh = loadState(path)
    if (result.pushed) {
      fresh.github = { ...fresh.github, last_sync: nowIso() }
      logActivity(fresh, 'auto-push', `pushed to ${result.branch}`)
    } else if (result.push_error) {
      logActivity(fresh, 'auto-push', `push failed: ${result.push_error}`)
    } else if (result.committed) {
      logActivity(fresh, 'auto-push', 'committed (nothing to push)')
    } else {
      return false
    }
    saveState(path, fresh)
    return result.pushed
  } catch {
    return false
  }
}

/** Test seam: forget every armed timer. */
export function resetAutoPush(): void {
  for (const timer of timers.values()) clearTimeout(timer)
  timers.clear()
}
