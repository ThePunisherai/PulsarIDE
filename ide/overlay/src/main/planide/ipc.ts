/**
 * PlanIDE's IPC surface: the tracker, exposed to the renderer.
 *
 * There is no server and no port. Each channel runs a main-process function
 * against the project's own `.planide/state.json` and returns plain data, the
 * same named-channel pattern every other Orca feature uses.
 *
 * A project is addressed by its filesystem path — the renderer already knows
 * the active worktree's path, so nothing has to be registered first and there
 * is no registry to keep in sync.
 */

import { ipcMain } from 'electron'
import * as backup from './backup'
import * as git from './git'
import { detect } from './detect'
import { buildReport, type ReportMode } from './report'
import {
  addFix,
  addItem,
  addMilestone,
  addVersion,
  deleteFix,
  deleteItem,
  deleteMilestone,
  loadState,
  lockItem,
  progress,
  projectExists,
  regressions,
  saveState,
  updateFix,
  updateItem,
  updateMilestone,
  verifyItem,
  type ItemStatus,
  type ProjectState
} from './store'

/** What the renderer gets back for a project: state plus derived rollups. */
export type ProjectPayload = ProjectState & {
  progress: ReturnType<typeof progress>
  regressions: ReturnType<typeof regressions>
  detected: ReturnType<typeof detect>
}

function mutate<T>(path: string, fn: (state: ProjectState) => T): { result: T; payload: ProjectPayload } {
  const state = loadState(path)
  const result = fn(state)
  saveState(path, state)
  return { result, payload: withRollups(state) }
}

function withRollups(state: ProjectState): ProjectPayload {
  return {
    ...state,
    progress: progress(state),
    regressions: regressions(state),
    detected: (state.stack?.detected ?? {}) as ReturnType<typeof detect>
  }
}

/**
 * Open a project: load its state, and refresh stack detection the first time
 * (or whenever it was never detected) so a new folder is useful immediately.
 */
function openProject(path: string): ProjectPayload {
  const state = loadState(path)
  const det = state.stack?.detected
  if (!det || !('type' in det) || !det.languages) {
    const fresh = detect(path)
    state.type = fresh.type
    state.stack = { detected: fresh, custom: state.stack?.custom ?? '' }
    saveState(path, state)
  }
  return withRollups(state)
}

let registered = false

export function registerPlanIdeIpc(): void {
  if (registered) return
  registered = true

  const on = <A extends unknown[], R>(
    channel: string,
    handler: (...args: A) => R | Promise<R>
  ): void => {
    ipcMain.handle(channel, async (_event, ...args: unknown[]) => {
      try {
        return { ok: true, data: await handler(...(args as A)) }
      } catch (err) {
        // A tracker failure must never take a renderer surface down with it.
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    })
  }

  // ---- project ---------------------------------------------------------- //
  on('planide:open', (path: string) => openProject(path))
  on('planide:exists', (path: string) => projectExists(path))
  on('planide:detect', (path: string) => detect(path))
  on('planide:redetect', (path: string) =>
    mutate(path, (s) => {
      const fresh = detect(path)
      s.type = fresh.type
      s.stack = { detected: fresh, custom: s.stack?.custom ?? '' }
      return fresh
    }).payload
  )
  on('planide:set-custom-stack', (path: string, custom: string) =>
    mutate(path, (s) => {
      s.stack = { detected: s.stack?.detected ?? {}, custom }
    }).payload
  )

  // ---- items ------------------------------------------------------------ //
  on(
    'planide:item-add',
    (path: string, opts: { title: string; status?: ItemStatus; notes?: string; priority?: string; tags?: string[] }) =>
      mutate(path, (s) => addItem(s, opts))
  )
  on(
    'planide:item-update',
    (path: string, itemId: string, fields: Record<string, unknown>) =>
      mutate(path, (s) => updateItem(s, itemId, fields)).payload
  )
  on('planide:item-delete', (path: string, itemId: string) =>
    mutate(path, (s) => deleteItem(s, itemId)).payload
  )
  // Confirmation and protection are the user's alone: separate channels, and
  // nothing agent-facing reaches them.
  on('planide:item-verify', (path: string, itemId: string, verified: boolean) =>
    mutate(path, (s) => verifyItem(s, itemId, verified)).payload
  )
  on('planide:item-lock', (path: string, itemId: string, locked: boolean) =>
    mutate(path, (s) => lockItem(s, itemId, locked)).payload
  )

  // ---- fixes ------------------------------------------------------------ //
  on(
    'planide:fix-add',
    (path: string, opts: { title: string; problem?: string; solution?: string; agent?: string }) =>
      mutate(path, (s) => addFix(s, opts)).payload
  )
  on('planide:fix-update', (path: string, fixId: string, fields: Record<string, unknown>) =>
    mutate(path, (s) => updateFix(s, fixId, fields)).payload
  )
  on('planide:fix-delete', (path: string, fixId: string) =>
    mutate(path, (s) => deleteFix(s, fixId)).payload
  )

  // ---- roadmap / versions ------------------------------------------------ //
  on('planide:milestone-add', (path: string, title: string, target: string) =>
    mutate(path, (s) => addMilestone(s, title, target)).payload
  )
  on('planide:milestone-update', (path: string, mid: string, fields: Record<string, unknown>) =>
    mutate(path, (s) => updateMilestone(s, mid, fields)).payload
  )
  on('planide:milestone-delete', (path: string, mid: string) =>
    mutate(path, (s) => deleteMilestone(s, mid)).payload
  )
  on(
    'planide:version-add',
    (path: string, version: string, opts: { notes?: string; added?: string[]; fixed?: string[]; changed?: string[] }) =>
      mutate(path, (s) => addVersion(s, version, opts)).payload
  )

  // ---- briefing ---------------------------------------------------------- //
  on('planide:report', (path: string, mode: ReportMode) => buildReport(loadState(path), mode))

  // ---- git --------------------------------------------------------------- //
  on('planide:git-status', (path: string) => git.status(path))
  on('planide:git-init', (path: string, branch: string) => git.init(path, branch))
  on('planide:git-set-remote', (path: string, url: string) => git.setRemote(path, url))
  on('planide:git-large-files', (path: string, mb: number) => git.largeFiles(path, mb))
  on('planide:git-lfs', (path: string, patterns: string[]) => git.trackLfs(path, patterns))
  on('planide:git-sync', (path: string, opts: { message?: string; push?: boolean }) =>
    git.sync(path, opts)
  )

  // ---- backups ----------------------------------------------------------- //
  on('planide:backup-create', (path: string, label: string) => {
    const state = loadState(path)
    return backup.create(path, state.version, label)
  })
  on('planide:backup-list', (path: string) => backup.listing(path))
  on('planide:backup-delete', (path: string, file: string) => backup.remove(path, file))
}
