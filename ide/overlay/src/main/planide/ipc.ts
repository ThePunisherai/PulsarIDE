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

import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import * as backup from './backup'
import { scheduleAutoPush, setAutoPush } from './auto-push'
import * as git from './git'
import { detect } from './detect'
import { graphPicture, memoryStatus } from './memory-status'
import { readGraphReport, reindexGraph } from './graphify-run'
import { connectOpenDesignToAgents, openDesignLaunch, openDesignStatus } from './open-design'
import { archifyRender, archifyStatus } from './archify-run'
import { stopWatchingBoard, watchBoard } from './board-watch'
import { deployCursorRule } from './agent-bundle'
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
  // Every change funnels through here, so this is the one place auto-push has
  // to be armed from. It is a no-op unless the project has it switched on.
  scheduleAutoPush(path, state)
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
  // Opening a project also starts watching its board, so an agent writing to
  // state.json refreshes the Tracker by itself. The sender is the surface that
  // asked, which is the one showing this project.
  ipcMain.handle('planide:open', async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
    try {
      const path = args[0] as string
      const payload = openProject(path)
      // Cursor is the one embedded agent with no user-scope persona location, so
      // its rule lives in the project. Now that the board exists, write it.
      // Best-effort by design: a read-only checkout must not break opening.
      deployCursorRule(path)
      watchBoard(path, (changed) => {
        if (!event.sender.isDestroyed()) event.sender.send('planide:board-changed', changed)
      })
      return { ok: true, data: payload }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
  on('planide:unwatch', () => {
    stopWatchingBoard()
    return true
  })
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

  // project memory: graphify graph + Obsidian note status, so the Tracker tab
  // can show graphify/Obsidian actually working for this project (read-only).
  on('planide:memory-status', (path: string) => memoryStatus(path))
  // Reading the graph and building it are different actions: Refresh only
  // ever re-read, which is why it looked like it did nothing.
  on('planide:graph-report', (path: string) => readGraphReport(path))
  on('planide:graph-picture', (path: string) => graphPicture(path))
  on('planide:reindex-graph', (path: string) => reindexGraph(path))
  // OpenDesign: read-only status, plus two explicitly user-triggered actions.
  on('planide:open-design-status', () => openDesignStatus())
  on('planide:open-design-connect', (agents: string[]) => connectOpenDesignToAgents(agents))
  on('planide:open-design-launch', () => openDesignLaunch())
  // Archify: list this project's diagrams, and render one on request. The
  // render takes a name and a type rather than a path, so nothing from the
  // renderer is ever joined onto disk.
  on('planide:archify-status', (path: string) => archifyStatus(path))
  on('planide:archify-render', (path: string, name: string, type: string) =>
    archifyRender(path, name, type))

  // ---- git --------------------------------------------------------------- //
  on('planide:git-status', (path: string) => git.status(path))
  on('planide:git-init', (path: string, branch: string) => git.init(path, branch))
  on('planide:git-set-remote', (path: string, url: string) => git.setRemote(path, url))
  on('planide:git-large-files', (path: string, mb: number) => git.largeFiles(path, mb))
  on('planide:git-lfs', (path: string, patterns: string[]) => git.trackLfs(path, patterns))
  on('planide:git-sync', (path: string, opts: { message?: string; push?: boolean }) =>
    git.sync(path, opts)
  )
  on('planide:git-auto-push', (path: string, enabled: boolean) =>
    mutate(path, (s) => setAutoPush(s, enabled, path)).payload
  )

  // ---- backups ----------------------------------------------------------- //
  on('planide:backup-create', (path: string, label: string) => {
    const state = loadState(path)
    return backup.create(path, state.version, label)
  })
  on('planide:backup-list', (path: string) => backup.listing(path))
  on('planide:backup-delete', (path: string, file: string) => backup.remove(path, file))
}
