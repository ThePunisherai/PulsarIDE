/**
 * Live board updates: watch the project's tracker file and tell the renderer.
 *
 * Without this the Tracker only ever showed what it read when you opened it, so
 * an agent working in the background filled the board and you saw nothing until
 * you reloaded — which is exactly the "I give it a task and nothing happens"
 * feeling, even once the agent really was writing.
 *
 * Watching the DIRECTORY, not the file, is deliberate: `saveState` writes
 * `state.json.tmp` and renames it over the target so a crash cannot truncate the
 * board. A watch on the file itself follows the replaced inode and goes silent
 * after the first save — the watch would appear to work once and then never
 * again. A directory watch sees every rename into it.
 *
 * The project root is watched too, so a board created *after* you opened the tab
 * (the common case now that the first agent turn creates it) still registers.
 *
 * Best-effort throughout: a filesystem that cannot watch simply never notifies,
 * and the manual Refresh button still works.
 */

import { watch, type FSWatcher } from 'node:fs'
import { join } from 'node:path'

/** Coalesce the burst of events a single save produces. */
const DEBOUNCE_MS = 120

type Watch = {
  path: string
  watchers: FSWatcher[]
  timer: NodeJS.Timeout | null
}

let active: Watch | null = null

function stopWatch(w: Watch | null): void {
  if (!w) return
  if (w.timer) clearTimeout(w.timer)
  for (const watcher of w.watchers) {
    try {
      watcher.close()
    } catch {
      /* already gone */
    }
  }
}

/**
 * Watch `projectPath`'s board and call `onChange` when it changes. Replaces any
 * previous watch (the tracker only ever shows the active worktree). Returns
 * true if at least one watcher was established.
 */
export function watchBoard(projectPath: string, onChange: (path: string) => void): boolean {
  if (active?.path === projectPath) return true // already watching this one
  stopWatch(active)
  active = null
  if (!projectPath) return false

  const w: Watch = { path: projectPath, watchers: [], timer: null }
  const fire = (): void => {
    if (w.timer) clearTimeout(w.timer)
    w.timer = setTimeout(() => {
      w.timer = null
      // A watch that outlived its replacement must not talk to the renderer.
      if (active === w) onChange(projectPath)
    }, DEBOUNCE_MS)
  }

  const add = (dir: string, interesting: (name: string) => boolean): void => {
    try {
      const watcher = watch(dir, (_event, filename) => {
        if (!filename || interesting(String(filename))) fire()
      })
      // A watcher error (directory removed, fs limits) must not throw into the
      // main process — drop that watcher and keep whatever else is working.
      watcher.on('error', () => {
        try {
          watcher.close()
        } catch {
          /* ignore */
        }
      })
      w.watchers.push(watcher)
    } catch {
      /* not watchable — the Refresh button still works */
    }
  }

  // The board itself, and the project root so a board created later is picked up.
  add(join(projectPath, '.planide'), (name) => name.startsWith('state.json'))
  add(projectPath, (name) => name === '.planide')

  if (!w.watchers.length) return false
  active = w
  return true
}

/** Stop watching (window closed, no project). */
export function stopWatchingBoard(): void {
  stopWatch(active)
  active = null
}
