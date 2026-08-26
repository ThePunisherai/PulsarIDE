/**
 * Per-workspace knowledge memory (graphify + Obsidian), for every agent.
 *
 * The graphify/Obsidian bootstrap used to run only through Claude Code's
 * SessionStart hook — so a project worked in Codex or Cursor never got a graph
 * or a note. This runs the same `council-memory.py` from the IDE's own main
 * process the moment any agent does work in a workspace, whichever tool it is,
 * so graphify's per-project `graphify-out/graph.json` and the project's Obsidian
 * note are created for that workspace automatically.
 *
 * Deliberately safe:
 *  * Throttled per project (6h, matching council-memory's own staleness window),
 *    so a busy session runs it at most once per project per window.
 *  * Detached and non-blocking — it can never delay or disturb the agent pipeline.
 *  * Best-effort — python3/council-memory.py/graphify missing just means no sync;
 *    the deployed venv's graphify is found even off PATH (council-memory.py looks
 *    in ~/.config/pulsaride/pyenv), and Obsidian is written only if a vault exists.
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { projectPathFromWorktreeId } from './agent-events'

/** Matches council-memory.py's own 6h graphify staleness window. */
const SYNC_THROTTLE_MS = 6 * 60 * 60 * 1000
const lastSyncByProject = new Map<string, number>()
const PROJECT_CACHE_CAP = 200

function configDir(home: string): string {
  return join(home, '.config', 'pulsaride')
}

/** The IDE venv python if provisioned (has graphify on its own path), else system. */
function memoryPython(home: string): string {
  if (process.platform !== 'win32') {
    const venv = join(configDir(home), 'pyenv', 'bin', 'python')
    return existsSync(venv) ? venv : 'python3'
  }
  // pythonw.exe is the same interpreter built without a console subsystem --
  // it ships beside python.exe in every venv and standard install for exactly
  // this reason. Preferring it means there is no console window to suppress in
  // the first place, rather than relying on a creation flag to hide one.
  // python.exe stays the fallback: a stripped or embeddable install may not
  // carry pythonw, and a working sync beats a hidden one.
  const scripts = join(configDir(home), 'pyenv', 'Scripts')
  for (const exe of ['pythonw.exe', 'python.exe']) {
    const candidate = join(scripts, exe)
    if (existsSync(candidate)) return candidate
  }
  return 'pythonw'
}

/**
 * Sync graphify + Obsidian for the workspace a turn happened in. Returns true
 * when a sync was launched (a no-op otherwise: no path, throttled, or the
 * memory script isn't deployed yet).
 */
export function maybeSyncMemory(
  worktreeId: string | undefined,
  opts: { home?: string; now?: number } = {}
): boolean {
  try {
    const home = opts.home ?? homedir()
    const project = projectPathFromWorktreeId(worktreeId)
    // Only real, local workspace directories — a remote (SSH) path won't exist here.
    if (!project || !existsSync(project)) return false

    const now = opts.now ?? Date.now()
    const last = lastSyncByProject.get(project)
    if (last !== undefined && now - last < SYNC_THROTTLE_MS) return false
    lastSyncByProject.set(project, now)
    if (lastSyncByProject.size > PROJECT_CACHE_CAP) {
      const oldest = lastSyncByProject.keys().next().value
      if (oldest !== undefined && oldest !== project) lastSyncByProject.delete(oldest)
    }

    const script = join(configDir(home), 'hooks', 'council-memory.py')
    if (!existsSync(script)) return false

    const child = spawn(
      memoryPython(home),
      [script, '--project', project, '--team', 'The Council', '--event', 'workspace-open'],
      // windowsHide as well as detached: detached alone stops THIS child
      // getting a console, but Windows ignores CREATE_NO_WINDOW when it is
      // combined with DETACHED_PROCESS, so the flag is belt-and-braces here.
      // The console window users actually saw came from graphify.exe, the
      // grandchild -- council-memory.py passes CREATE_NO_WINDOW itself.
      { detached: true, stdio: 'ignore', windowsHide: true }
    )
    child.unref()
    return true
  } catch {
    // Memory is best-effort; it must never disturb the agent pipeline.
    return false
  }
}

/** Test seam: forget the per-project throttle. */
export function resetMemorySyncCache(): void {
  lastSyncByProject.clear()
}
